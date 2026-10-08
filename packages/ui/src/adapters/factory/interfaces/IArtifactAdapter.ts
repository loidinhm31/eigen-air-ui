import type {
  ImageArtifactList,
  ImageArtifactRef,
  ImageJobCreateRequest,
  ImageJobSnapshot,
  ImageSafeCode,
  ImageTemplateList,
} from "@eigen-air-ui/shared/types";

/**
 * Failure categories for local-image REST access. Messages are fixed per kind and never
 * carry response text, prompts, paths, or tokens.
 *
 * - unauthorized: HTTP 401 (body is empty and never parsed)
 * - not_found: HTTP 404 or 403 (uniform denial; callers MUST NOT distinguish missing, foreign,
 *   deleted or forbidden, and MUST invalidate any cached bytes for the affected scope; body unread)
 * - invalid_request: HTTP 422, or a request rejected locally before sending
 * - conflict: HTTP 409 (stale `expected_revision`)
 * - unavailable: HTTP 503 or any other 5xx; `code` is an allowlisted safe code or undefined
 * - network: fetch rejected or the body stream failed (not caused by our abort signal)
 * - aborted: the caller's AbortSignal fired
 * - integrity: byte verification failed (content type, length, PNG header, dimensions, SHA-256)
 * - too_large: byte stream or header exceeded the verified `byte_size` / 16 MiB cap
 * - protocol: undecodable/oversized body, unexpected status (incl. redirects), incoherent or
 *   scope-mismatched response
 * - page_cap: artifact listing did not terminate within the hard page cap
 * - unsupported: `crypto.subtle` is unavailable (insecure context); bytes are never returned unverified
 */
export type ArtifactAdapterErrorKind =
  | "unauthorized"
  | "not_found"
  | "invalid_request"
  | "conflict"
  | "unavailable"
  | "network"
  | "aborted"
  | "integrity"
  | "too_large"
  | "protocol"
  | "page_cap"
  | "unsupported";

export class ArtifactAdapterError extends Error {
  readonly kind: ArtifactAdapterErrorKind;
  /** HTTP status when the error originates from a response. */
  readonly status?: number;
  /** Allowlisted safe code; only set for `unavailable` responses. */
  readonly code?: ImageSafeCode;

  constructor(
    kind: ArtifactAdapterErrorKind,
    options: { status?: number; code?: ImageSafeCode } = {}
  ) {
    super(`artifact_adapter_${kind}`);
    this.name = "ArtifactAdapterError";
    this.kind = kind;
    if (options.status !== undefined) this.status = options.status;
    if (options.code !== undefined) this.code = options.code;
  }
}

export interface ArtifactRequestOptions {
  signal?: AbortSignal;
}

export interface ArtifactJobSelector {
  jobId: string;
  sessionId: string;
  runId: string;
}

export interface ArtifactCancelRequest extends ArtifactJobSelector {
  /** Snapshot revision the caller observed; must be >= 1. */
  expectedRevision: number;
}

export interface ArtifactCancelResult {
  /** Authorized snapshot returned by the daemon. */
  snapshot: ImageJobSnapshot;
  /**
   * true for HTTP 202 (cancel recorded, child may still be running); false for 200 terminal
   * no-op. Coherence enforced by the adapter (`protocol` otherwise): 200 => terminal state;
   * 202 => `cancel_requested` or a terminal state (a quick cancel can settle directly, or race
   * to a terminal state before the snapshot is projected). Never evidence that a job was killed:
   * status truth is a later `getJob`.
   */
  pending: boolean;
}

export interface ArtifactPageQuery {
  sessionId: string;
  runId?: string;
  /** Opaque cursor from a previous page; never parsed. */
  cursor?: string;
  /** 1..100, default 20. */
  limit?: number;
}

export interface ArtifactListQuery {
  sessionId: string;
  runId?: string;
}

/** Trusted metadata (from an authorized listing) that the downloaded bytes must match. */
export interface ArtifactBytesRequest {
  artifactId: string;
  sessionId: string;
  runId: string;
  byteSize: number;
  /** 64 hex chars, case-insensitive. */
  sha256: string;
  width: number;
  height: number;
}

export interface ArtifactBytesOptions extends ArtifactRequestOptions {
  /** Default `inline`. */
  disposition?: "inline" | "attachment";
}

export interface ArtifactDownload {
  /** Verified `image/png` blob. */
  blob: Blob;
  /** Client-derived `<artifact_id>.png`. */
  filename: string;
}

export interface IArtifactAdapter {
  /** GET /v1/image-templates. */
  listTemplates(options?: ArtifactRequestOptions): Promise<ImageTemplateList>;
  /** POST /v1/image-jobs (validated, <= 32 KiB, expects 202). */
  createJob(
    request: ImageJobCreateRequest,
    options?: ArtifactRequestOptions
  ): Promise<ImageJobSnapshot>;
  /** GET /v1/image-jobs/:id?session_id=&run_id= (status truth). */
  getJob(
    selector: ArtifactJobSelector,
    options?: ArtifactRequestOptions
  ): Promise<ImageJobSnapshot>;
  /** POST /v1/image-jobs/:id/cancel (202 pending / 200 terminal / 409 conflict). */
  cancelJob(
    request: ArtifactCancelRequest,
    options?: ArtifactRequestOptions
  ): Promise<ArtifactCancelResult>;
  /** One page of GET /v1/sessions/:session_id/image-artifacts. */
  listArtifactsPage(
    query: ArtifactPageQuery,
    options?: ArtifactRequestOptions
  ): Promise<ImageArtifactList>;
  /** Follows `next_cursor` (hard page cap, fail closed), de-duplicated by artifact_id. */
  listAllArtifacts(
    query: ArtifactListQuery,
    options?: ArtifactRequestOptions
  ): Promise<ImageArtifactRef[]>;
  /** Fresh authenticated bounded GET with full byte verification; no partial blob on failure. */
  fetchArtifactBytes(request: ArtifactBytesRequest, options?: ArtifactBytesOptions): Promise<Blob>;
  /** Fresh `disposition=attachment` GET; callers revoke any object URL right after use. */
  downloadArtifact(
    request: ArtifactBytesRequest,
    options?: ArtifactRequestOptions
  ): Promise<ArtifactDownload>;
}
