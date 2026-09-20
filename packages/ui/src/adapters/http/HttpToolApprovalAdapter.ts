import {
  decodeToolApprovalDetailResponse,
  decodeToolApprovalListResponse,
  errorKindForToolApprovalStatus,
  type ToolApprovalHttpErrorKind,
  type ToolApprovalListResponse,
  type ToolApprovalResolveDecision,
  type ToolApprovalSnapshot,
} from "@nonclaw-ui/shared/types";
import type { IToolApprovalService } from "../factory/interfaces/IToolApprovalService.js";
import { fetchWithAccess, type AccessSource } from "./AuthenticatedHttpRequest.js";

export type ToolApprovalAccessSource = AccessSource;

const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 4096;

export class ToolApprovalHttpError extends Error {
  readonly kind: ToolApprovalHttpErrorKind;
  readonly status: number;
  readonly code?: string;

  constructor(status: number, kind: ToolApprovalHttpErrorKind, code?: string) {
    super(messageForKind(kind));
    this.name = "ToolApprovalHttpError";
    this.status = status;
    this.kind = kind;
    this.code = safeErrorCode(code);
  }
}

function messageForKind(kind: ToolApprovalHttpErrorKind): string {
  switch (kind) {
    case "unauthorized":
    case "forbidden":
    case "not_found":
      return "Approval unavailable";
    case "conflict":
      return "Approval changed or was already resolved";
    case "invalid":
      return "Approval request was rejected";
    case "aborted":
      return "Approval request cancelled";
    case "unavailable":
      return "Approval service unavailable; try again";
  }
}

function safeErrorCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z0-9_:-]{1,64}$/.test(value) ? value : undefined;
}

function validRevision(revision: number): boolean {
  return Number.isSafeInteger(revision) && revision >= 0;
}

function encodeApprovalQuery(query: { sessionId: string; runId: string; limit?: number }): string {
  if (!query.sessionId || !query.runId) {
    throw new ToolApprovalHttpError(422, "invalid");
  }
  const params = new URLSearchParams({
    session_id: query.sessionId,
    run_id: query.runId,
  });
  if (query.limit !== undefined) {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100) {
      throw new ToolApprovalHttpError(422, "invalid");
    }
    params.set("limit", query.limit.toString());
  }
  return params.toString();
}

async function readBoundedJson(response: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<unknown> {
  const contentLength = response.headers?.get?.("Content-Length");
  if (contentLength) {
    const parsed = Number.parseInt(contentLength, 10);
    if (Number.isSafeInteger(parsed) && parsed > maxBytes) {
      throw new ToolApprovalHttpError(0, "unavailable");
    }
  }

  if (typeof response.text === "function") {
    const text = await response.text();
    if (text.length > maxBytes) {
      throw new ToolApprovalHttpError(0, "unavailable");
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ToolApprovalHttpError(0, "unavailable");
    }
  }
  return response.json();
}

export class HttpToolApprovalAdapter implements IToolApprovalService {
  constructor(
    private readonly baseUrl: string,
    private readonly access: ToolApprovalAccessSource = {}
  ) {}

  private async response(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      const response = await fetchWithAccess(this.baseUrl, path, this.access, {
        ...init,
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
      });

      if (response.ok) return response;

      let code: string | undefined;
      try {
        const text = await response.text();
        if (text.length <= MAX_ERROR_RESPONSE_BYTES) {
          const body: unknown = JSON.parse(text);
          if (
            body !== null &&
            typeof body === "object" &&
            "error" in body &&
            body.error !== null &&
            typeof body.error === "object" &&
            "code" in body.error
          ) {
            code = safeErrorCode(body.error.code);
          }
        }
      } catch {
        // Status is the only authority for safe UI normalization.
      }

      throw new ToolApprovalHttpError(
        response.status,
        errorKindForToolApprovalStatus(response.status),
        code
      );
    } catch (error) {
      if (error instanceof ToolApprovalHttpError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ToolApprovalHttpError(0, "aborted");
      }
      throw new ToolApprovalHttpError(0, "unavailable");
    }
  }

  async list(
    query: { sessionId: string; runId: string; limit?: number },
    signal?: AbortSignal
  ): Promise<ToolApprovalListResponse> {
    const encoded = encodeApprovalQuery(query);
    const response = await this.response(`/v1/tool-approvals?${encoded}`, { signal });
    const json = await readBoundedJson(response);
    return decodeToolApprovalListResponse(json);
  }

  async get(
    approvalId: string,
    query: { sessionId: string; runId: string },
    signal?: AbortSignal
  ): Promise<ToolApprovalSnapshot> {
    if (!approvalId) throw new ToolApprovalHttpError(422, "invalid");
    const encoded = encodeApprovalQuery(query);
    const response = await this.response(
      `/v1/tool-approvals/${encodeURIComponent(approvalId)}?${encoded}`,
      { signal }
    );
    const json = await readBoundedJson(response);
    const detail = decodeToolApprovalDetailResponse(json);
    return detail.approval;
  }

  async resolve(
    approvalId: string,
    query: { sessionId: string; runId: string },
    expectedRevision: number,
    decision: ToolApprovalResolveDecision,
    signal?: AbortSignal
  ): Promise<ToolApprovalSnapshot> {
    if (!approvalId) throw new ToolApprovalHttpError(422, "invalid");
    if (!validRevision(expectedRevision)) throw new ToolApprovalHttpError(422, "invalid");
    if (decision !== "allow_once" && decision !== "deny") {
      throw new ToolApprovalHttpError(422, "invalid");
    }

    const encoded = encodeApprovalQuery(query);
    const response = await this.response(
      `/v1/tool-approvals/${encodeURIComponent(approvalId)}/resolve?${encoded}`,
      {
        method: "POST",
        body: JSON.stringify({
          expected_revision: expectedRevision,
          decision,
        }),
        signal,
      }
    );

    const json = await readBoundedJson(response);
    const detail = decodeToolApprovalDetailResponse(json);
    return detail.approval;
  }
}
