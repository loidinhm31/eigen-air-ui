import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ToolApprovalListResponse,
  ToolApprovalSnapshot,
} from "@nonclaw-ui/shared/types";
import type { IToolApprovalService } from "../../adapters/factory/interfaces/IToolApprovalService.js";
import { ToolApprovalHttpError } from "../../adapters/http/HttpToolApprovalAdapter.js";
import { useToolApprovalStore } from "../../stores/toolApprovalStore.js";
import { ToolApprovalController } from "./toolApprovalController.js";

function pendingSnapshot(overrides: Partial<ToolApprovalSnapshot> = {}): ToolApprovalSnapshot {
  return {
    approval_id: "app-1",
    schema_version: "tool_approval.v1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    session_id: "session-1",
    run_id: "run-1",
    tool_call_id: "call-1",
    ordinal: 1,
    tool_name: "shell",
    operation: "execute",
    risk: "high",
    state: "pending",
    safe_summary: {
      program: "ls",
      args_count: 1,
      working_dir: "workspace_root",
    },
    binding_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    revision: 1,
    created_at_ms: 1000,
    expires_at_ms: Date.now() + 10_000,
    terminal_at_ms: null,
    terminal_code: null,
    decision_by_credential_id: null,
    redaction: "metadata_only",
    ...overrides,
  };
}

function fakeService(overrides: Partial<IToolApprovalService> = {}) {
  let pending = true;
  const snapshot = pendingSnapshot();
  const service: IToolApprovalService = {
    list: vi.fn(
      async (): Promise<ToolApprovalListResponse> => ({
        schema_version: "tool_approval.v1",
        approvals: pending ? [snapshot] : [],
        redaction: "metadata_only",
      })
    ),
    get: vi.fn(
      async (): Promise<ToolApprovalSnapshot> =>
        pending ? snapshot : { ...snapshot, state: "approved_once", revision: 2 }
    ),
    resolve: vi.fn(async (_id, _q, _rev, decision): Promise<ToolApprovalSnapshot> => {
      pending = false;
      return {
        ...snapshot,
        state: decision === "allow_once" ? "approved_once" : "denied",
        revision: 2,
      };
    }),
    ...overrides,
  };
  return { service, setPending: (val: boolean) => (pending = val) };
}

describe("ToolApprovalController", () => {
  beforeEach(() => {
    useToolApprovalStore.getState().clearAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useToolApprovalStore.getState().clearAll();
  });

  it("fetches list and establishes ready pending state on setContext", async () => {
    const { service } = fakeService();
    const controller = new ToolApprovalController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1", runId: "run-1" });
    await controller.refresh();

    expect(service.list).toHaveBeenCalledWith(
      { sessionId: "session-1", runId: "run-1", limit: 100 },
      expect.any(AbortSignal)
    );
    expect(useToolApprovalStore.getState().status).toBe("ready");
    expect(controller.getPending()?.approval_id).toBe("app-1");
    expect(controller.canMutate("app-1")).toBe(true);
  });

  it("marks offline on disconnect and refreshes on reconnect", async () => {
    const { service } = fakeService();
    const controller = new ToolApprovalController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1", runId: "run-1" });
    await controller.refresh();

    controller.onConnectionStatus("disconnected");
    expect(useToolApprovalStore.getState().status).toBe("offline");
    expect(controller.canMutate("app-1")).toBe(false);

    controller.onConnectionStatus("connected");
    await controller.refresh();
    expect(useToolApprovalStore.getState().status).toBe("ready");
    expect(controller.canMutate("app-1")).toBe(true);
  });

  it("fetches detail on approval hint and updates revision", async () => {
    const { service } = fakeService();
    const controller = new ToolApprovalController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1", runId: "run-1" });
    await controller.refresh();

    controller.onApprovalHint({
      type: "event",
      event: "tool_approval.updated",
      payload: {
        approval_id: "app-1",
        tool_call_id: "call-1",
        tool_name: "shell",
        state: "pending",
        revision: 2,
        redaction: "metadata_only",
      },
    });

    expect(useToolApprovalStore.getState().lastEventRevision["app-1"]).toBe(2);
  });

  it("resolves allow_once, latches accepted ID, and clears card when state advances", async () => {
    const { service } = fakeService();
    const controller = new ToolApprovalController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1", runId: "run-1" });
    await controller.refresh();

    const ok = await controller.resolve("app-1", "allow_once");
    expect(ok).toBe(true);
    expect(service.resolve).toHaveBeenCalledWith(
      "app-1",
      { sessionId: "session-1", runId: "run-1" },
      1,
      "allow_once",
      expect.any(AbortSignal)
    );
    expect(controller.isAccepted("app-1")).toBe(true);
    expect(controller.canMutate("app-1")).toBe(false);
    expect(controller.getPending()).toBeUndefined();
  });

  it("resolves deny and clears card", async () => {
    const { service } = fakeService();
    const controller = new ToolApprovalController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1", runId: "run-1" });
    await controller.refresh();

    const ok = await controller.resolve("app-1", "deny");
    expect(ok).toBe(true);
    expect(service.resolve).toHaveBeenCalledWith(
      "app-1",
      { sessionId: "session-1", runId: "run-1" },
      1,
      "deny",
      expect.any(AbortSignal)
    );
    expect(controller.getPending()).toBeUndefined();
  });

  it("handles 409 conflict by refetching and reporting safe conflict message", async () => {
    const { service, setPending } = fakeService({
      resolve: vi.fn().mockImplementation(async () => {
        setPending(false);
        throw new ToolApprovalHttpError(409, "conflict");
      }),
    });
    const controller = new ToolApprovalController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1", runId: "run-1" });
    await controller.refresh();

    const ok = await controller.resolve("app-1", "allow_once");
    expect(ok).toBe(false);
    expect(useToolApprovalStore.getState().error).toBe(
      "Approval changed or was already resolved"
    );
    expect(controller.getPending()).toBeUndefined();
  });

  it("handles mutation 404 by disabling controls if pending remains readable", async () => {
    const { service } = fakeService({
      resolve: vi.fn().mockRejectedValue(new ToolApprovalHttpError(404, "not_found")),
    });
    const controller = new ToolApprovalController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1", runId: "run-1" });
    await controller.refresh();

    const ok = await controller.resolve("app-1", "allow_once");
    expect(ok).toBe(false);
    expect(useToolApprovalStore.getState().disabledApprovalIds["app-1"]).toBe(true);
    expect(useToolApprovalStore.getState().error).toBe(
      "Approval resolution unavailable for current credentials"
    );
    expect(controller.canMutate("app-1")).toBe(false);
  });

  it("handles list 404 by clearing snapshot and marking ready", async () => {
    const { service } = fakeService({
      list: vi.fn().mockRejectedValue(new ToolApprovalHttpError(404, "not_found")),
    });
    const controller = new ToolApprovalController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1", runId: "run-1" });
    await controller.refresh();

    expect(useToolApprovalStore.getState().status).toBe("ready");
    expect(controller.getPending()).toBeUndefined();
  });

  it("handles 401/403 by clearing context and store", async () => {
    const { service } = fakeService({
      list: vi.fn().mockRejectedValue(new ToolApprovalHttpError(401, "unauthorized")),
    });
    const controller = new ToolApprovalController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1", runId: "run-1" });
    await controller.refresh();

    expect(useToolApprovalStore.getState().status).toBe("idle");
    expect(useToolApprovalStore.getState().context).toBeUndefined();
  });

  it("handles 422 by keeping card ready with safe rejected message", async () => {
    const { service } = fakeService({
      resolve: vi.fn().mockRejectedValue(new ToolApprovalHttpError(422, "invalid")),
    });
    const controller = new ToolApprovalController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1", runId: "run-1" });
    await controller.refresh();

    const ok = await controller.resolve("app-1", "allow_once");
    expect(ok).toBe(false);
    expect(useToolApprovalStore.getState().status).toBe("ready");
    expect(useToolApprovalStore.getState().error).toBe("Approval request was rejected");
    expect(controller.canMutate("app-1")).toBe(true);
  });

  it("handles 503 by keeping card ready and permitting another click after settling", async () => {
    const { service } = fakeService({
      resolve: vi.fn().mockRejectedValue(new ToolApprovalHttpError(503, "unavailable")),
    });
    const controller = new ToolApprovalController({ service });
    controller.setContext({ daemonUrl: "http://daemon", sessionId: "session-1", runId: "run-1" });
    await controller.refresh();

    const ok = await controller.resolve("app-1", "allow_once");
    expect(ok).toBe(false);
    expect(useToolApprovalStore.getState().status).toBe("ready");
    expect(useToolApprovalStore.getState().error).toBe(
      "Approval service unavailable; try again"
    );
    expect(controller.canMutate("app-1")).toBe(true);
  });
});
