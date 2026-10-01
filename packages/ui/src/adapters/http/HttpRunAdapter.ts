import {
  decodeMemoryOutcome,
  decodeRequestProvenance,
  decodeTaskOutcome,
  decodeToolSelection,
  type RunExportDto,
  type RunListResponseDto,
  type RunSnapshotDto,
  type RunTreeNodeDto,
} from "@eigen-air-ui/shared/types";
import {
  fetchWithAccess,
  type AccessContext,
  type AccessSource,
  type RunCapabilities,
} from "./AuthenticatedHttpRequest.js";
import { formatRunTextExport } from "./run-text-export.js";

const MAX_RUN_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_RUN_ERROR_MESSAGE_BYTES = 512;
const MAX_TEXT_EXPORT_PAGES = 256;

export type { RunCapabilities };

export interface RunListOptions {
  sessionId?: string;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface RunGetOptions {
  includeDebug?: boolean;
  eventCursor?: string;
  toolCursor?: string;
  lineageCursor?: string;
  debugCursor?: string;
  signal?: AbortSignal;
}

/** Authenticated host state. It is consumed in memory and never serialized by this adapter. */
export type RunAccessContext = AccessContext;

type RunAccessSource = AccessSource;


function safeRunErrorMessage(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_RUN_ERROR_MESSAGE_BYTES ||
    /[\r\n]/.test(value) ||
    /\b(?:answer|auth(?:entication)?[_ ]?token|mutation[_ ]?token|access[_ ]?token)\b/i.test(value) ||
    /\b[a-f0-9]{32,}\b/i.test(value)
  ) {
    return undefined;
  }
  return value;
}
function sanitizeSnapshot(snapshot: RunSnapshotDto): RunSnapshotDto {
  if (!snapshot || !Array.isArray(snapshot.events)) {
    return snapshot;
  }
  return {
    ...snapshot,
    events: snapshot.events.map((event) => ({
      ...event,
      tool_selection: event.tool_selection ? decodeToolSelection(event.tool_selection) ?? undefined : undefined,
      memory_outcome: event.memory_outcome ? decodeMemoryOutcome(event.memory_outcome) ?? undefined : undefined,
      request_provenance: event.request_provenance
        ? decodeRequestProvenance(event.request_provenance) ?? undefined
        : undefined,
      task_outcome: event.task_outcome ? decodeTaskOutcome(event.task_outcome) ?? undefined : undefined,
    })),
  };
}


async function readSafeRunErrorMessage(response: Response): Promise<string | undefined> {
  const contentLength = response.headers?.get("content-length");
  if (contentLength) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > MAX_RUN_ERROR_MESSAGE_BYTES * 4) return undefined;
  }

  try {
    const body =
      typeof response.text === "function"
        ? JSON.parse(await response.text())
        : await response.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
    const message = (body as { message?: unknown }).message;
    return safeRunErrorMessage(message);
  } catch {
    return undefined;
  }
}

/** Stateless REST client: callers own the short-lived in-memory result. */
export class HttpRunAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly access: RunAccessSource = {}
  ) {}

  private accessContext(): RunAccessContext {
    return (typeof this.access === "function" ? this.access() : this.access) ?? {};
  }

  private async response(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetchWithAccess(this.baseUrl, path, this.access, init);
    if (!response.ok) {
      const message = await readSafeRunErrorMessage(response);
      const error = new Error(message ?? `Run request failed: ${response.status}`);
      Object.assign(error, { status: response.status });
      throw error;
    }
    return response;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.response(path, init);
    // Successful DELETE responses are intentionally empty (204).
    if (response.status === 204) return undefined as T;
    if (response.headers?.get("content-length")) {
      const length = Number(response.headers.get("content-length"));
      if (Number.isFinite(length) && length > MAX_RUN_RESPONSE_BYTES) {
        throw new Error("Run response exceeds the safe size limit");
      }
    }
    if (typeof response.text === "function") {
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > MAX_RUN_RESPONSE_BYTES) {
        throw new Error("Run response exceeds the safe size limit");
      }
      return JSON.parse(text) as T;
    }
    return response.json() as Promise<T>;
  }

  list(options: RunListOptions = {}): Promise<RunListResponseDto> {
    const limit = options.limit ?? 50;
    const params = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, limit))) });
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.sessionId) params.set("session_id", options.sessionId);
    const query = `?${params.toString()}`;
    return this.request(`/v1/runs${query}`, { signal: options.signal });
  }

  async get(runId: string, options: RunGetOptions = {}): Promise<RunSnapshotDto> {
    const params = new URLSearchParams();
    // A local UI flag is never authority; default deny until authenticated state injects capability.
    const debug = Boolean(
      options.includeDebug && this.accessContext().capabilities?.has("run:read:debug")
    );
    if (debug) {
      params.set("include_debug", "true");
      if (options.debugCursor) {
        params.set("debug_cursor", options.debugCursor);
      }
    }
    if (options.eventCursor) params.set("event_cursor", options.eventCursor);
    if (options.toolCursor) params.set("tool_cursor", options.toolCursor);
    if (options.lineageCursor) params.set("lineage_cursor", options.lineageCursor);

    const query = params.toString() ? `?${params.toString()}` : "";
    const snapshot = await this.request<RunSnapshotDto>(`/v1/runs/${encodeURIComponent(runId)}${query}`, {
      signal: options.signal,
    });
    return sanitizeSnapshot(snapshot);
  }

  getRunTree(rootSessionId: string, signal?: AbortSignal): Promise<RunTreeNodeDto[]> {
    return this.request(`/v1/run-trees/${encodeURIComponent(rootSessionId)}`, { signal });
  }

  async export(runId: string, signal?: AbortSignal): Promise<Blob> {
    if (!this.accessContext().capabilities?.has("run:export")) {
      throw new Error("Run export unavailable");
    }
    const response = await this.response(`/v1/runs/${encodeURIComponent(runId)}/export`, { signal });
    const blob = await response.blob();
    if (blob.size > MAX_RUN_RESPONSE_BYTES) throw new Error("Run export exceeds the safe size limit");
    return blob;
  }

  /** Explicit user action only. Plaintext is local to this call, never cached or persisted. */
  async exportText(runId: string, signal?: AbortSignal): Promise<Blob> {
    const capabilities = this.accessContext().capabilities;
    if (!capabilities?.has("run:export")) throw new Error("Run export unavailable");
    const includeDebug = capabilities.has("run:read:debug");
    const params = new URLSearchParams({ include_text: "true" });
    if (includeDebug) params.set("include_debug", "true");
    const exported = await this.request<RunExportDto>(
      `/v1/runs/${encodeURIComponent(runId)}/export?${params.toString()}`,
      { signal }
    );
    if (exported.run.run_id !== runId) throw new Error("Run export correlation mismatch");
    const snapshot: RunExportDto = { ...exported, ...sanitizeSnapshot(exported) };
    if (!includeDebug) {
      snapshot.debug_excerpts = [];
      snapshot.next_debug_cursor = null;
    }
    const encoder = new TextEncoder();
    let bytes = encoder.encode(JSON.stringify(snapshot)).byteLength;
    let pages = 0;
    const disclosures: string[] = [];
    // Each stream has an independent cursor. Never reuse unrelated arrays returned with a page.
    const streams = [
      { name: "events", cursor: "next_event_cursor", option: "eventCursor", rows: "events" },
      { name: "tools", cursor: "next_tool_cursor", option: "toolCursor", rows: "tool_calls" },
      { name: "debug", cursor: "next_debug_cursor", option: "debugCursor", rows: "debug_excerpts" },
    ] as const;
    for (const stream of streams) {
      let cursor = snapshot[stream.cursor];
      const seenCursors = new Set<string>();
      while (cursor) {
        signal?.throwIfAborted();
        if (pages >= MAX_TEXT_EXPORT_PAGES || bytes >= MAX_RUN_RESPONSE_BYTES || seenCursors.has(cursor)) {
          disclosures.push(`TRUNCATED: ${stream.name} pagination stopped at the 8 MiB / ${MAX_TEXT_EXPORT_PAGES}-page bound or a repeated server cursor; additional records remain unavailable in this file.`);
          break;
        }
        seenCursors.add(cursor);
        const page = await this.get(runId, {
          [stream.option]: cursor,
          includeDebug: stream.name === "debug" && includeDebug,
          signal,
        });
        pages += 1;
        if (page.run.run_id !== runId || page.run.session_id !== snapshot.run.session_id) {
          throw new Error("Run export page correlation mismatch");
        }
        const rows = page[stream.rows] ?? [];
        const pageBytes = encoder.encode(JSON.stringify(rows)).byteLength;
        if (bytes + pageBytes > MAX_RUN_RESPONSE_BYTES) {
          disclosures.push(`TRUNCATED: ${stream.name} history exceeds the 8 MiB export bound; remaining pages omitted.`);
          break;
        }
        bytes += pageBytes;
        // The endpoint returns overlapping pages for other streams; deduplicate only this stream.
        if (stream.rows === "events") {
          const ids = new Set(snapshot.events.map((row) => row.event_id));
          snapshot.events.push(...page.events.filter((row) => !ids.has(row.event_id)));
        } else if (stream.rows === "tool_calls") {
          const ids = new Set(snapshot.tool_calls.map((row) => row.tool_call_id));
          snapshot.tool_calls.push(...page.tool_calls.filter((row) => !ids.has(row.tool_call_id)));
        } else {
          const ids = new Set((snapshot.debug_excerpts ?? []).map((row) => row.excerpt_seq));
          snapshot.debug_excerpts = [
            ...(snapshot.debug_excerpts ?? []),
            ...(page.debug_excerpts ?? []).filter((row) => !ids.has(row.excerpt_seq)),
          ];
          if (page.run.redaction.unavailable_reason) {
            disclosures.push(`Debug history unavailable: ${page.run.redaction.unavailable_reason}.`);
          }
        }
        cursor = page[stream.cursor];
      }
    }
    signal?.throwIfAborted();
    const blob = new Blob([formatRunTextExport(snapshot, includeDebug, disclosures)], {
      type: "text/plain;charset=utf-8",
    });
    if (blob.size > MAX_RUN_RESPONSE_BYTES) throw new Error("Run text export exceeds the safe size limit");
    return blob;
  }

  async delete(runId: string, signal?: AbortSignal): Promise<void> {
    if (!this.accessContext().capabilities?.has("run:delete")) {
      throw new Error("Run deletion unavailable");
    }
    await this.request<void>(`/v1/runs/${encodeURIComponent(runId)}`, { method: "DELETE", signal });
  }
}
