import {
  IMAGE_CREATE_REQUEST_MAX_BYTES,
  IMAGE_MAX_CURSOR_BYTES,
  IMAGE_TERMINAL_JOB_STATES,
  IMAGE_MAX_LIST_ITEMS,
  IMAGE_SAFE_CODES,
  decodeImageArtifactList,
  decodeImageJobSnapshot,
  decodeImageTemplateList,
  isImageId,
  validateImageJobCancelRequest,
  validateImageJobCreateRequest,
  type ImageArtifactList,
  type ImageArtifactRef,
  type ImageJobCreateRequest,
  type ImageJobSnapshot,
  type ImageSafeCode,
  type ImageTemplateList,
} from "@eigen-air-ui/shared/types";
import {
  ArtifactAdapterError,
  type ArtifactAdapterErrorKind,
  type ArtifactBytesOptions,
  type ArtifactBytesRequest,
  type ArtifactCancelRequest,
  type ArtifactCancelResult,
  type ArtifactDownload,
  type ArtifactJobSelector,
  type ArtifactListQuery,
  type ArtifactPageQuery,
  type ArtifactRequestOptions,
  type IArtifactAdapter,
} from "../factory/interfaces/IArtifactAdapter.js";
import { fetchWithAccess, type AccessSource } from "./AuthenticatedHttpRequest.js";
import {
  discardBody,
  isValidExpectedPng,
  readBoundedBytes,
  readVerifiedPng,
  type ExpectedPng,
} from "./artifact-bytes.js";

export const ARTIFACT_DEFAULT_PAGE_LIMIT = 20;
/** Hard ceiling on pages followed by `listAllArtifacts`; exceeding it fails closed. */
export const ARTIFACT_MAX_LIST_PAGES = 50;
const MAX_JSON_RESPONSE_BYTES = 256 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;
const encoder = new TextEncoder();

/** Identifiers are path/query components; `.`/`..` would be normalized away by URL parsing. */
function checkId(value: unknown): string {
  if (!isImageId(value) || /^\.+$/.test(value)) throw new ArtifactAdapterError("invalid_request");
  return value;
}

function query(params: Array<[string, string | undefined]>): string {
  const parts = params
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

function kindForStatus(status: number): ArtifactAdapterErrorKind {
  if (status === 401) return "unauthorized";
  // 403 (hub/proxy-issued) is the same uniform denial as 404: callers invalidate cached bytes.
  if (status === 403 || status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "invalid_request";
  if (status >= 500 && status <= 599) return "unavailable";
  return "protocol";
}

/** Field-by-field equality for the flat artifact ref: every key and value must match. */
function sameArtifact(a: ImageArtifactRef, b: ImageArtifactRef): boolean {
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((k) => left[k] === right[k]);
}

/** Extracts an allowlisted safe code from `{"error":{"code":"..."}}`; anything else is undefined. */
async function safeCodeFrom(
  response: Response,
  signal?: AbortSignal
): Promise<ImageSafeCode | undefined> {
  try {
    const bytes = await readBoundedBytes(response, MAX_ERROR_RESPONSE_BYTES, signal);
    if (!bytes || bytes.byteLength === 0) return undefined;
    const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
    return typeof code === "string" && (IMAGE_SAFE_CODES as readonly string[]).includes(code)
      ? (code as ImageSafeCode)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Local HTTP adapter for local-image jobs, templates, artifact listing, and verified bytes. */
export class HttpArtifactAdapter implements IArtifactAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly access: AccessSource = {}
  ) {}

  private async send(
    path: string,
    init: RequestInit,
    accept: string,
    signal?: AbortSignal
  ): Promise<Response> {
    if (signal?.aborted) throw new ArtifactAdapterError("aborted");
    try {
      return await fetchWithAccess(this.baseUrl, path, this.access, {
        ...init,
        cache: "no-store",
        // Contract: no redirects. A followed redirect could replay the bearer or return a
        // foreign body; `error` rejects the fetch, which maps to `network`.
        redirect: "error",
        ...(signal ? { signal } : {}),
        headers: {
          Accept: accept,
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch {
      throw new ArtifactAdapterError(signal?.aborted ? "aborted" : "network");
    }
  }

  /** Throws the typed error for a non-accepted response; consumes at most 64 KiB of 5xx bodies. */
  private async reject(response: Response, signal?: AbortSignal): Promise<never> {
    const kind = kindForStatus(response.status);
    if (kind !== "unavailable") {
      discardBody(response);
      // 403/404 are one uniform denial; the raw status would be an existence oracle.
      throw new ArtifactAdapterError(kind, kind === "not_found" ? {} : { status: response.status });
    }
    const code = await safeCodeFrom(response, signal);
    if (signal?.aborted) throw new ArtifactAdapterError("aborted");
    throw new ArtifactAdapterError(kind, { status: response.status, ...(code ? { code } : {}) });
  }

  /** Sends, enforces one of `accepted` statuses, and returns the bounded, parsed JSON body. */
  private async requestJson(
    path: string,
    init: RequestInit,
    accepted: readonly number[],
    signal?: AbortSignal
  ): Promise<{ status: number; body: unknown }> {
    const response = await this.send(path, init, "application/json", signal);
    if (!accepted.includes(response.status)) return this.reject(response, signal);
    const bytes = await readBoundedBytes(response, MAX_JSON_RESPONSE_BYTES, signal);
    if (!bytes) throw new ArtifactAdapterError("protocol", { status: response.status });
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return { status: response.status, body: JSON.parse(text) };
    } catch {
      throw new ArtifactAdapterError("protocol", { status: response.status });
    }
  }

  private decode<T>(value: unknown, decoder: (input: unknown) => T): T {
    try {
      return decoder(value);
    } catch {
      throw new ArtifactAdapterError("protocol");
    }
  }

  /** A snapshot for a different job/scope than requested is never trusted. */
  private checkSnapshotScope(
    snapshot: ImageJobSnapshot,
    scope: { sessionId: string; runId?: string; jobId?: string }
  ): ImageJobSnapshot {
    if (
      snapshot.session_id !== scope.sessionId ||
      (scope.runId !== undefined && snapshot.run_id !== scope.runId) ||
      (scope.jobId !== undefined && snapshot.job_id !== scope.jobId)
    ) {
      throw new ArtifactAdapterError("protocol");
    }
    return snapshot;
  }

  async listTemplates(options: ArtifactRequestOptions = {}): Promise<ImageTemplateList> {
    const { body } = await this.requestJson(
      "/v1/image-templates",
      { method: "GET" },
      [200],
      options.signal
    );
    return this.decode(body, decodeImageTemplateList);
  }

  async createJob(
    request: ImageJobCreateRequest,
    options: ArtifactRequestOptions = {}
  ): Promise<ImageJobSnapshot> {
    let payload: string;
    let valid: ImageJobCreateRequest;
    try {
      valid = validateImageJobCreateRequest(request);
      payload = JSON.stringify(valid);
    } catch {
      throw new ArtifactAdapterError("invalid_request");
    }
    if (encoder.encode(payload).byteLength > IMAGE_CREATE_REQUEST_MAX_BYTES) {
      throw new ArtifactAdapterError("invalid_request");
    }
    const { body } = await this.requestJson(
      "/v1/image-jobs",
      { method: "POST", body: payload },
      [202],
      options.signal
    );
    const snapshot = this.checkSnapshotScope(this.decode(body, decodeImageJobSnapshot), {
      sessionId: valid.session_id,
    });
    // Contract-stable echo of what we asked for (never mutable job state): a forged or
    // misrouted response for another origin/template is not trusted.
    if (snapshot.origin !== "direct_template" || snapshot.template_id !== valid.template_id) {
      throw new ArtifactAdapterError("protocol");
    }
    return snapshot;
  }

  async getJob(
    selector: ArtifactJobSelector,
    options: ArtifactRequestOptions = {}
  ): Promise<ImageJobSnapshot> {
    const jobId = checkId(selector.jobId);
    const sessionId = checkId(selector.sessionId);
    const runId = checkId(selector.runId);
    const { body } = await this.requestJson(
      `/v1/image-jobs/${encodeURIComponent(jobId)}${query([
        ["session_id", sessionId],
        ["run_id", runId],
      ])}`,
      { method: "GET" },
      [200],
      options.signal
    );
    return this.checkSnapshotScope(this.decode(body, decodeImageJobSnapshot), {
      jobId,
      sessionId,
      runId,
    });
  }

  async cancelJob(
    request: ArtifactCancelRequest,
    options: ArtifactRequestOptions = {}
  ): Promise<ArtifactCancelResult> {
    const jobId = checkId(request.jobId);
    let payload: string;
    try {
      payload = JSON.stringify(
        validateImageJobCancelRequest({
          session_id: request.sessionId,
          run_id: request.runId,
          expected_revision: request.expectedRevision,
        })
      );
    } catch {
      throw new ArtifactAdapterError("invalid_request");
    }
    const { status, body } = await this.requestJson(
      `/v1/image-jobs/${encodeURIComponent(jobId)}/cancel`,
      { method: "POST", body: payload },
      [200, 202],
      options.signal
    );
    const snapshot = this.checkSnapshotScope(this.decode(body, decodeImageJobSnapshot), {
      jobId,
      sessionId: request.sessionId,
      runId: request.runId,
    });
    // Route truth (`routes/image_jobs.rs` cancel): 200 only when the job was already terminal;
    // 202 only after the cancel CAS, so the snapshot is `cancel_requested` (running/publishing),
    // `cancelled` (admitted/submitting settle directly) or a terminal state it raced to.
    const terminal = IMAGE_TERMINAL_JOB_STATES.includes(snapshot.state);
    if (status === 200 ? !terminal : !terminal && snapshot.state !== "cancel_requested") {
      throw new ArtifactAdapterError("protocol");
    }
    return { snapshot, pending: status === 202 };
  }

  async listArtifactsPage(
    request: ArtifactPageQuery,
    options: ArtifactRequestOptions = {}
  ): Promise<ImageArtifactList> {
    const sessionId = checkId(request.sessionId);
    const runId = request.runId === undefined ? undefined : checkId(request.runId);
    const limit = request.limit ?? ARTIFACT_DEFAULT_PAGE_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > IMAGE_MAX_LIST_ITEMS) {
      throw new ArtifactAdapterError("invalid_request");
    }
    const cursor = request.cursor;
    if (
      cursor !== undefined &&
      (typeof cursor !== "string" ||
        cursor.length === 0 ||
        encoder.encode(cursor).byteLength > IMAGE_MAX_CURSOR_BYTES)
    ) {
      throw new ArtifactAdapterError("invalid_request");
    }
    const { body } = await this.requestJson(
      `/v1/sessions/${encodeURIComponent(sessionId)}/image-artifacts${query([
        ["run_id", runId],
        ["cursor", cursor],
        ["limit", String(limit)],
      ])}`,
      { method: "GET" },
      [200],
      options.signal
    );
    const page = this.decode(body, decodeImageArtifactList);
    // Defense in depth: the daemon filters by scope, but a foreign item is never surfaced.
    for (const item of page.items) {
      if (item.session_id !== sessionId || (runId !== undefined && item.run_id !== runId)) {
        throw new ArtifactAdapterError("protocol");
      }
    }
    return page;
  }

  async listAllArtifacts(
    request: ArtifactListQuery,
    options: ArtifactRequestOptions = {}
  ): Promise<ImageArtifactRef[]> {
    const firstById = new Map<string, ImageArtifactRef>();
    const seenCursors = new Set<string>();
    const items: ImageArtifactRef[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < ARTIFACT_MAX_LIST_PAGES; page += 1) {
      const result = await this.listArtifactsPage(
        {
          sessionId: request.sessionId,
          ...(request.runId !== undefined ? { runId: request.runId } : {}),
          ...(cursor !== undefined ? { cursor } : {}),
          limit: IMAGE_MAX_LIST_ITEMS,
        },
        options
      );
      for (const item of result.items) {
        const prior = firstById.get(item.artifact_id);
        if (prior === undefined) {
          firstById.set(item.artifact_id, item);
          items.push(item);
        } else if (!sameArtifact(prior, item)) {
          // An identical repeat across a page boundary is tolerated; a conflicting one is not.
          throw new ArtifactAdapterError("protocol");
        }
      }
      if (result.next_cursor === null) return items;
      // A repeated cursor can never terminate; fail rather than spend the whole page budget.
      if (seenCursors.has(result.next_cursor)) throw new ArtifactAdapterError("protocol");
      seenCursors.add(result.next_cursor);
      cursor = result.next_cursor;
    }
    throw new ArtifactAdapterError("page_cap");
  }

  async fetchArtifactBytes(
    request: ArtifactBytesRequest,
    options: ArtifactBytesOptions = {}
  ): Promise<Blob> {
    const artifactId = checkId(request.artifactId);
    const sessionId = checkId(request.sessionId);
    const runId = checkId(request.runId);
    const expected: ExpectedPng = {
      byteSize: request.byteSize,
      sha256: request.sha256,
      width: request.width,
      height: request.height,
    };
    const disposition = options.disposition ?? "inline";
    if (
      !isValidExpectedPng(expected) ||
      (disposition !== "inline" && disposition !== "attachment")
    ) {
      throw new ArtifactAdapterError("invalid_request");
    }
    const response = await this.send(
      `/v1/image-artifacts/${encodeURIComponent(artifactId)}${query([
        ["session_id", sessionId],
        ["run_id", runId],
        ["disposition", disposition],
      ])}`,
      { method: "GET" },
      "image/png",
      options.signal
    );
    if (response.status !== 200) return this.reject(response, options.signal);
    return readVerifiedPng(response, expected, options.signal);
  }

  async downloadArtifact(
    request: ArtifactBytesRequest,
    options: ArtifactRequestOptions = {}
  ): Promise<ArtifactDownload> {
    const blob = await this.fetchArtifactBytes(request, {
      ...options,
      disposition: "attachment",
    });
    return { blob, filename: `${request.artifactId}.png` };
  }
}
