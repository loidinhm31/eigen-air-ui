import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  UserQuestionListResponse,
  UserQuestionMutationResponse,
  UserQuestionSnapshot,
} from "@nonclaw-ui/shared/types";
import type { RunSnapshotDto } from "@nonclaw-ui/shared/types";
import type { IUserQuestionService } from "../../adapters/factory/interfaces/IUserQuestionService.js";
import { UserQuestionHttpError } from "../../adapters/http/HttpUserQuestionAdapter.js";
import { useUserQuestionStore } from "../../stores/userQuestionStore.js";
import { UserQuestionController } from "./userQuestionController.js";

afterEach(() => useUserQuestionStore.getState().clearAll());

function pendingDetail(): UserQuestionSnapshot {
  return {
    schema_version: "user_question.v1",
    question_id: "question-1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    session_id: "session-1",
    run_id: "run-1",
    turn_index: 1,
    state: "pending",
    revision: 1,
    created_at_ms: 1,
    expires_at_ms: 2,
    terminal_at_ms: null,
    redaction: "metadata_only",
    request: { kind: "short_text", prompt: "What should the note say?" },
    mutation_token: "a".repeat(32),
  };
}

function metadataFrom(detail: UserQuestionSnapshot) {
  const metadata = { ...detail };
  delete metadata.request;
  delete metadata.mutation_token;
  return metadata;
}

function runSnapshot(): RunSnapshotDto {
  return {
    schema_version: 1,
    run: {
      run_id: "run-1",
      trace_id: "trace-1",
      session_id: "session-1",
      root_run_id: "run-1",
      tenant_id: "tenant-1",
      user_id: "user-1",
      workspace_id: "workspace-1",
      agent_id: "agent-1",
      provider_id: "provider-1",
      channel: "web",
      lifecycle_status: "running",
      started_at_ms: 1,
      updated_at_ms: 1,
      snapshot_seq: 1,
      correlation_state: "active",
      redaction: { metadata_only: true, debug_requested: false, debug_available: false },
    },
    events: [],
    tool_calls: [],
    memory_lineage: [],
  };
}

function fakeService(overrides: Partial<IUserQuestionService> = {}) {
  let pending = true;
  const detail = pendingDetail();
  const service: IUserQuestionService = {
    list: vi.fn(
      async (): Promise<UserQuestionListResponse> => ({
        schema_version: "user_question.v1",
        questions: pending ? [metadataFrom(detail)] : [],
        redaction: "metadata_only",
      })
    ),
    get: vi.fn(
      async (): Promise<UserQuestionSnapshot> =>
        pending ? detail : { ...metadataFrom(detail), state: "resolved", revision: 2 }
    ),
    resolve: vi.fn(async (): Promise<UserQuestionMutationResponse> => {
      pending = false;
      return {
        schema_version: "user_question.v1",
        question: { ...metadataFrom(detail), state: "resolved", revision: 2 },
        status: "accepted",
      };
    }),
    cancel: vi.fn(async (): Promise<UserQuestionMutationResponse> => {
      pending = false;
      return {
        schema_version: "user_question.v1",
        question: { ...metadataFrom(detail), state: "cancelled", revision: 2 },
        status: "accepted",
      };
    }),
    ...overrides,
  };
  return { service, setPending: (value: boolean) => (pending = value) };
}

describe("UserQuestionController", () => {
  it("waits for question, run, and history snapshots before enabling controls", async () => {
    const { service } = fakeService();
    const getHistory = vi.fn().mockResolvedValue({ messages: [] });
    const getRunSnapshot = vi.fn().mockResolvedValue(runSnapshot());
    const controller = new UserQuestionController({ service, getHistory, getRunSnapshot });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1" });
    controller.onConnectionStatus("connected");
    await controller.refresh();
    expect(getHistory).toHaveBeenCalledWith("session-1", expect.any(AbortSignal));
    expect(getRunSnapshot).toHaveBeenCalledWith("run-1", expect.any(AbortSignal));
    expect(useUserQuestionStore.getState().status).toBe("ready");
    expect(useUserQuestionStore.getState().composerBlockedSessionId).toBe("session-1");
  });

  it("allows exactly one resolve and clears the pending composer block only after REST refresh", async () => {
    const { service } = fakeService();
    const controller = new UserQuestionController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1" });
    await controller.refresh();
    const first = controller.resolve("question-1", "plain answer");
    const second = controller.resolve("question-1", "second answer");
    await expect(second).resolves.toBe(false);
    await expect(first).resolves.toBe(true);
    expect(service.resolve).toHaveBeenCalledOnce();
    expect(service.resolve).toHaveBeenCalledWith(
      "question-1",
      { sessionId: "session-1", runId: "run-1" },
      1,
      "a".repeat(32),
      { kind: "short_text", text: "plain answer" },
      expect.any(AbortSignal)
    );
    expect(useUserQuestionStore.getState().composerBlockedSessionId).toBeUndefined();
    expect(JSON.stringify(useUserQuestionStore.getState())).not.toContain("plain answer");
  });

  it("refetches on stale conflict and never terminalizes optimistically", async () => {
    const { service } = fakeService({
      resolve: vi.fn(async () => {
        throw new UserQuestionHttpError(409, "conflict");
      }),
    });
    const controller = new UserQuestionController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1" });
    await controller.refresh();
    await expect(controller.resolve("question-1", "plain answer")).resolves.toBe(false);
    expect(service.list).toHaveBeenCalledTimes(2);
    expect(useUserQuestionStore.getState().snapshots["question-1"]?.state).toBe("pending");
    expect(useUserQuestionStore.getState().error).toContain("changed");
  });

  it("queues a second authoritative refresh when a hint races the first refresh", async () => {
    let releaseFirstList!: (value: UserQuestionListResponse) => void;
    const firstList = new Promise<UserQuestionListResponse>((resolve) => {
      releaseFirstList = resolve;
    });
    const { service } = fakeService({
      list: vi
        .fn()
        .mockImplementationOnce(() => firstList)
        .mockImplementation(async () => ({
          schema_version: "user_question.v1",
          questions: [],
          redaction: "metadata_only",
        })),
    });
    const controller = new UserQuestionController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1" });
    const firstRefresh = controller.refresh();
    controller.onQuestionHint();
    releaseFirstList({
      schema_version: "user_question.v1",
      questions: [],
      redaction: "metadata_only",
    });
    await firstRefresh;
    await controller.refresh();
    expect(service.list).toHaveBeenCalledTimes(2);
  });

  it("clears every question on detail 404 and authorization changes", async () => {
    const { service } = fakeService({
      get: vi.fn(async () => {
        throw new UserQuestionHttpError(404, "not_found");
      }),
    });
    const controller = new UserQuestionController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1" });
    await controller.refresh();
    expect(useUserQuestionStore.getState().snapshots).toEqual({});

    const unauthorized = fakeService({
      list: vi.fn(async () => {
        throw new UserQuestionHttpError(401, "unauthorized");
      }),
    });
    const authController = new UserQuestionController({ service: unauthorized.service });
    authController.setContext({ daemonUrl: "http://daemon", sessionId: "session-1" });
    await authController.refresh();
    expect(useUserQuestionStore.getState().snapshots).toEqual({});
    expect(useUserQuestionStore.getState().context).toBeUndefined();
  });

  it("clears all authority on session/generation invalidation", async () => {
    const { service } = fakeService();
    const controller = new UserQuestionController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1" });
    await controller.refresh();
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-2" });
    expect(useUserQuestionStore.getState().snapshots).toEqual({});
    expect(useUserQuestionStore.getState().composerBlockedSessionId).toBeUndefined();
  });

  it("keeps metadata-only pending state read-only while preserving the server composer guard", async () => {
    const detail = pendingDetail();
    delete detail.mutation_token;
    const { service } = fakeService({
      get: vi.fn(async () => metadataFrom(detail)),
    });
    const controller = new UserQuestionController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1" });
    await controller.refresh();
    expect(controller.canMutate("question-1")).toBe(false);
    expect(controller.getPending()?.request).toBeUndefined();
    expect(useUserQuestionStore.getState().composerBlockedSessionId).toBe("session-1");
  });

  it("does not report success until an accepted 202 converges to terminal state", async () => {
    const { service } = fakeService();
    service.resolve = vi.fn(async (): Promise<UserQuestionMutationResponse> => ({
      schema_version: "user_question.v1",
      question: { ...metadataFrom(pendingDetail()), state: "resolved", revision: 2 },
      status: "accepted",
    }));
    const controller = new UserQuestionController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1" });
    await controller.refresh();
    await expect(controller.resolve("question-1", "still pending")).resolves.toBe(false);
    expect(useUserQuestionStore.getState().status).toBe("ready");
    expect(useUserQuestionStore.getState().error).toContain("resuming");
    expect(useUserQuestionStore.getState().snapshots["question-1"]?.state).toBe("pending");
    expect(controller.isAccepted("question-1")).toBe(true);
    await expect(controller.resolve("question-1", "duplicate")).resolves.toBe(false);
    expect(service.resolve).toHaveBeenCalledOnce();
  });

  it("restores controls after a 422 without terminalizing the pending question", async () => {
    const { service } = fakeService({
      resolve: vi.fn(async () => {
        throw new UserQuestionHttpError(422, "invalid");
      }),
    });
    const controller = new UserQuestionController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1" });
    await controller.refresh();
    await expect(controller.resolve("question-1", "bad")).resolves.toBe(false);
    expect(useUserQuestionStore.getState().status).toBe("ready");
    expect(useUserQuestionStore.getState().mutationQuestionId).toBeUndefined();
    expect(useUserQuestionStore.getState().snapshots["question-1"]?.state).toBe("pending");
  });

  it("starts a fresh authoritative refresh after a context switch aborts the old one", async () => {
    let releaseFirstList!: (value: UserQuestionListResponse) => void;
    const firstList = new Promise<UserQuestionListResponse>((resolve) => {
      releaseFirstList = resolve;
    });
    const { service } = fakeService({
      list: vi
        .fn()
        .mockImplementationOnce(() => firstList)
        .mockResolvedValue({
          schema_version: "user_question.v1",
          questions: [],
          redaction: "metadata_only",
        }),
    });
    const controller = new UserQuestionController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1" });
    const oldRefresh = controller.refresh();
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-2" });
    const newRefresh = controller.refresh();
    releaseFirstList({
      schema_version: "user_question.v1",
      questions: [],
      redaction: "metadata_only",
    });
    await expect(newRefresh).resolves.toBe(true);
    await expect(oldRefresh).resolves.toBe(false);
    expect(service.list).toHaveBeenCalledTimes(2);
    expect(useUserQuestionStore.getState().context?.sessionId).toBe("session-2");
    expect(useUserQuestionStore.getState().status).toBe("ready");
  });

  it("keeps the originating composer fenced through answered and continuing states", async () => {
    let phase: "pending" | "answered" | "resolved" = "pending";
    const detail = pendingDetail();
    const service = fakeService().service;
    service.list = vi.fn(async (): Promise<UserQuestionListResponse> => ({
      schema_version: "user_question.v1",
      questions:
        phase === "resolved"
          ? []
          : [{ ...metadataFrom(detail), state: phase, revision: phase === "pending" ? 1 : 2 }],
      redaction: "metadata_only",
    }));
    service.get = vi.fn(async () =>
      phase === "pending"
        ? detail
        : { ...metadataFrom(detail), state: phase, revision: 2 }
    );
    service.resolve = vi.fn(async () => {
      phase = "answered";
      return {
        schema_version: "user_question.v1" as const,
        question: { ...metadataFrom(detail), state: "answered" as const, revision: 2 },
        status: "accepted" as const,
      };
    });
    const controller = new UserQuestionController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1" });
    await controller.refresh();
    await expect(controller.resolve("question-1", "answer")).resolves.toBe(false);
    expect(useUserQuestionStore.getState().snapshots["question-1"]?.state).toBe("answered");
    expect(useUserQuestionStore.getState().composerBlockedSessionId).toBe("session-1");
    expect(useUserQuestionStore.getState().error).toContain("resuming");

    phase = "resolved";
    await expect(controller.refresh()).resolves.toBe(true);
    expect(useUserQuestionStore.getState().composerBlockedSessionId).toBeUndefined();
  });

  it("ignores a mutation response after a session context switch", async () => {
    let release!: (value: UserQuestionMutationResponse) => void;
    const response = new Promise<UserQuestionMutationResponse>((resolve) => {
      release = resolve;
    });
    const { service } = fakeService({ resolve: vi.fn(() => response) });
    const controller = new UserQuestionController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1" });
    await controller.refresh();

    const mutation = controller.resolve("question-1", "late answer");
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-2" });
    release({
      schema_version: "user_question.v1",
      question: { ...metadataFrom(pendingDetail()), state: "resolved", revision: 2 },
      status: "accepted",
    });

    await expect(mutation).resolves.toBe(false);
    expect(useUserQuestionStore.getState().context?.sessionId).toBe("session-2");
    expect(useUserQuestionStore.getState().error).toBeUndefined();
    expect(useUserQuestionStore.getState().mutationQuestionId).toBeUndefined();
  });
});
