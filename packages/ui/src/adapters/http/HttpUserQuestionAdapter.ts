import {
  decodeUserQuestionList,
  decodeUserQuestionMutation,
  decodeUserQuestionSnapshot,
  errorKindForStatus,
  type UserQuestionHttpErrorKind,
  type UserQuestionAnswer,
  type UserQuestionListResponse,
  type UserQuestionMutationResponse,
  type UserQuestionSnapshot,
} from "@nonclaw-ui/shared/types";
import type {
  IUserQuestionService,
  UserQuestionQuery,
} from "../factory/interfaces/IUserQuestionService.js";
import { fetchWithAccess, type AccessSource } from "./AuthenticatedHttpRequest.js";

export interface UserQuestionAccessContext {
  authToken?: string;
  identityKey?: string;
}

export type UserQuestionAccessSource = AccessSource;

export class UserQuestionHttpError extends Error {
  readonly kind: UserQuestionHttpErrorKind;
  readonly status: number;
  readonly code?: string;

  constructor(status: number, kind: UserQuestionHttpErrorKind, code?: string) {
    super(messageForKind(kind));
    this.name = "UserQuestionHttpError";
    this.status = status;
    this.kind = kind;
    this.code = safeErrorCode(code);
  }
}

function messageForKind(kind: UserQuestionHttpErrorKind): string {
  switch (kind) {
    case "unauthorized":
    case "forbidden":
    case "not_found":
      return "Question unavailable";
    case "conflict":
      return "Question changed or was already answered";
    case "invalid":
      return "That response was rejected";
    case "aborted":
      return "Question request cancelled";
    case "unavailable":
      return "Question service unavailable";
  }
}

function safeErrorCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z0-9_:-]{1,64}$/.test(value) ? value : undefined;
}

function validMutationToken(token: string): boolean {
  return /^[a-f0-9]{32}$/.test(token);
}

function validRevision(revision: number): boolean {
  return Number.isSafeInteger(revision) && revision >= 0;
}

function encodeQuery(query: UserQuestionQuery): string {
  const params = new URLSearchParams({ session_id: query.sessionId });
  if (query.runId !== undefined) params.set("run_id", query.runId);
  return params.toString();
}

export class HttpUserQuestionAdapter implements IUserQuestionService {
  constructor(
    private readonly baseUrl: string,
    private readonly access: UserQuestionAccessSource = {}
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
        const body: unknown = await response.json();
        if (
          typeof body === "object" &&
          body !== null &&
          !Array.isArray(body) &&
          typeof (body as { error?: unknown }).error === "object" &&
          (body as { error: { code?: unknown } }).error !== null
        ) {
          code = safeErrorCode((body as { error: { code?: unknown } }).error.code);
        }
      } catch {
        // Status is the only authority for safe UI normalization.
      }
      throw new UserQuestionHttpError(response.status, errorKindForStatus(response.status), code);
    } catch (error) {
      if (error instanceof UserQuestionHttpError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new UserQuestionHttpError(0, "aborted");
      }
      throw new UserQuestionHttpError(0, "unavailable");
    }
  }

  async list(query: UserQuestionQuery, signal?: AbortSignal): Promise<UserQuestionListResponse> {
    const response = await this.response(`/v1/user-questions?${encodeQuery(query)}`, { signal });
    return decodeUserQuestionList(await response.json());
  }

  async get(
    questionId: string,
    query: Required<UserQuestionQuery>,
    signal?: AbortSignal
  ): Promise<UserQuestionSnapshot> {
    const response = await this.response(
      `/v1/user-questions/${encodeURIComponent(questionId)}?${encodeQuery(query)}`,
      { signal }
    );
    return decodeUserQuestionSnapshot(await response.json());
  }

  async resolve(
    questionId: string,
    query: Required<UserQuestionQuery>,
    expectedRevision: number,
    mutationToken: string,
    answer: UserQuestionAnswer,
    signal?: AbortSignal
  ): Promise<UserQuestionMutationResponse> {
    return this.mutate(
      `/v1/user-questions/${encodeURIComponent(questionId)}/resolve?${encodeQuery(query)}`,
      { expected_revision: expectedRevision, mutation_token: mutationToken, answer },
      signal
    );
  }

  async cancel(
    questionId: string,
    query: Required<UserQuestionQuery>,
    expectedRevision: number,
    mutationToken: string,
    signal?: AbortSignal
  ): Promise<UserQuestionMutationResponse> {
    return this.mutate(
      `/v1/user-questions/${encodeURIComponent(questionId)}/cancel?${encodeQuery(query)}`,
      { expected_revision: expectedRevision, mutation_token: mutationToken },
      signal
    );
  }

  private async mutate(
    path: string,
    body: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<UserQuestionMutationResponse> {
    const expectedRevision = body.expected_revision;
    const mutationToken = body.mutation_token;
    if (
      typeof expectedRevision !== "number" ||
      !validRevision(expectedRevision) ||
      typeof mutationToken !== "string" ||
      !validMutationToken(mutationToken)
    ) {
      throw new UserQuestionHttpError(422, "invalid");
    }
    const response = await this.response(path, {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    });
    if (response.status !== 202) {
      throw new UserQuestionHttpError(response.status, errorKindForStatus(response.status));
    }
    return decodeUserQuestionMutation(await response.json());
  }
}
