import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HttpToolApprovalAdapter,
  ToolApprovalHttpError,
} from "./HttpToolApprovalAdapter.js";

afterEach(() => vi.unstubAllGlobals());

const sampleSnapshot = {
  approval_id: "approval-1",
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
  created_at_ms: 1700000000000,
  expires_at_ms: 1700000900000,
  terminal_at_ms: null,
  terminal_code: null,
  decision_by_credential_id: null,
  redaction: "metadata_only",
};

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("HttpToolApprovalAdapter", () => {
  it("sends authenticated no-store requests with AbortSignal and encoded scope", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        schema_version: "tool_approval.v1",
        approvals: [sampleSnapshot],
        redaction: "metadata_only",
      })
    );
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    const adapter = new HttpToolApprovalAdapter("http://daemon", { authToken: "auth-secret" });
    const result = await adapter.list(
      { sessionId: "session/a", runId: "run/1", limit: 50 },
      signal
    );

    expect(fetch).toHaveBeenCalledWith(
      "http://daemon/v1/tool-approvals?session_id=session%2Fa&run_id=run%2F1&limit=50",
      expect.objectContaining({ cache: "no-store", signal })
    );
    const headers = new Headers(fetch.mock.calls[0]?.[1].headers);
    expect(headers.get("Authorization")).toBe("Bearer auth-secret");
    expect(headers.get("Accept")).toBe("application/json");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: "omit" });
    expect(result.approvals).toHaveLength(1);
    expect(result.approvals[0].approval_id).toBe("approval-1");
  });

  it("reads rotated host credentials at request time without persisting them", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        schema_version: "tool_approval.v1",
        approvals: [],
        redaction: "metadata_only",
      })
    );
    vi.stubGlobal("fetch", fetch);
    let access = { authToken: "first-token", identityKey: "identity-1" };
    const adapter = new HttpToolApprovalAdapter("http://daemon", () => access);
    await adapter.list({ sessionId: "session-1", runId: "run-1" });
    access = { authToken: "second-token", identityKey: "identity-2" };
    await adapter.list({ sessionId: "session-1", runId: "run-1" });
    expect(new Headers(fetch.mock.calls[0]?.[1].headers).get("Authorization")).toBe(
      "Bearer first-token"
    );
    expect(new Headers(fetch.mock.calls[1]?.[1].headers).get("Authorization")).toBe(
      "Bearer second-token"
    );
    expect(JSON.stringify(adapter)).not.toContain("second-token");
  });

  it("unwraps detail response on get", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        schema_version: "tool_approval.v1",
        approval: sampleSnapshot,
        redaction: "metadata_only",
      })
    );
    vi.stubGlobal("fetch", fetch);
    const adapter = new HttpToolApprovalAdapter("http://daemon");
    const snapshot = await adapter.get("app/1", { sessionId: "session-1", runId: "run-1" });

    expect(fetch).toHaveBeenCalledWith(
      "http://daemon/v1/tool-approvals/app%2F1?session_id=session-1&run_id=run-1",
      expect.anything()
    );
    expect(snapshot.approval_id).toBe("approval-1");
    expect(snapshot.state).toBe("pending");
  });

  it("sends exact resolve mutation and unwraps detail response", async () => {
    const resolvedSnapshot = {
      ...sampleSnapshot,
      state: "approved_once",
      revision: 2,
    };
    const fetch = vi.fn().mockResolvedValue(
      response({
        schema_version: "tool_approval.v1",
        approval: resolvedSnapshot,
        redaction: "metadata_only",
      })
    );
    vi.stubGlobal("fetch", fetch);
    const adapter = new HttpToolApprovalAdapter("http://daemon");
    const snapshot = await adapter.resolve(
      "approval-1",
      { sessionId: "session-1", runId: "run-1" },
      1,
      "allow_once"
    );

    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body as string)).toEqual({
      expected_revision: 1,
      decision: "allow_once",
    });
    expect(snapshot.state).toBe("approved_once");
    expect(snapshot.revision).toBe(2);
  });

  it("rejects invalid inputs before network I/O", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const adapter = new HttpToolApprovalAdapter("http://daemon");

    // Missing runId
    await expect(adapter.list({ sessionId: "session-1", runId: "" })).rejects.toMatchObject({
      status: 422,
      kind: "invalid",
    });

    // Missing approvalId
    await expect(
      adapter.get("", { sessionId: "session-1", runId: "run-1" })
    ).rejects.toMatchObject({ status: 422, kind: "invalid" });

    // Negative revision
    await expect(
      adapter.resolve("id", { sessionId: "session-1", runId: "run-1" }, -1, "allow_once")
    ).rejects.toMatchObject({ status: 422, kind: "invalid" });

    // Invalid decision
    await expect(
      adapter.resolve(
        "id",
        { sessionId: "session-1", runId: "run-1" },
        1,
        "allow_always" as unknown as "allow_once"
      )
    ).rejects.toMatchObject({ status: 422, kind: "invalid" });

    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [422, "invalid"],
    [503, "unavailable"],
  ] as const)("normalizes HTTP %s as %s without exposing response text", async (status, kind) => {
    const secret = "leaked-secret-content";
    const fetch = vi.fn().mockResolvedValue(
      response({ error: { code: "safe_code", message: secret } }, status)
    );
    vi.stubGlobal("fetch", fetch);
    const operation = new HttpToolApprovalAdapter("http://daemon").resolve(
      "approval-1",
      { sessionId: "session-1", runId: "run-1" },
      1,
      "deny"
    );
    await expect(operation).rejects.toMatchObject({ kind, status });
    await expect(operation).rejects.toBeInstanceOf(ToolApprovalHttpError);
    try {
      await operation;
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it("normalizes an aborted fetch without retaining secrets", async () => {
    const fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("private-details"), { name: "AbortError" })
    );
    vi.stubGlobal("fetch", fetch);
    const operation = new HttpToolApprovalAdapter("http://daemon").get(
      "approval-1",
      { sessionId: "session-1", runId: "run-1" },
      new AbortController().signal
    );
    await expect(operation).rejects.toMatchObject({ kind: "aborted", status: 0 });
  });
});
