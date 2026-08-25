import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpUserQuestionAdapter, UserQuestionHttpError } from "./HttpUserQuestionAdapter.js";

afterEach(() => vi.unstubAllGlobals());

const metadata = {
  schema_version: "user_question.v1",
  question_id: "question-1",
  tenant_id: "tenant-1",
  user_id: "user-1",
  workspace_id: "workspace-1",
  session_id: "session-1",
  run_id: "run-1",
  turn_index: 1,
  state: "pending",
  revision: 3,
  created_at_ms: 1,
  expires_at_ms: 2,
  terminal_at_ms: null,
  redaction: "metadata_only",
} as const;

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("HttpUserQuestionAdapter", () => {
  it("sends authenticated no-store requests with AbortSignal and encoded scope", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({ schema_version: "user_question.v1", questions: [], redaction: "metadata_only" })
    );
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    await new HttpUserQuestionAdapter("http://daemon", { authToken: "auth-secret" }).list(
      { sessionId: "session/a" },
      signal
    );
    expect(fetch).toHaveBeenCalledWith(
      "http://daemon/v1/user-questions?session_id=session%2Fa",
      expect.objectContaining({ cache: "no-store", signal })
    );
    expect(fetch.mock.calls[0]?.[1].headers).toMatchObject({
      Authorization: "Bearer auth-secret",
      Accept: "application/json",
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: "include" });
  });

  it("reads rotated host credentials at request time without persisting them", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({ schema_version: "user_question.v1", questions: [], redaction: "metadata_only" })
    );
    vi.stubGlobal("fetch", fetch);
    let access = { authToken: "first-token", identityKey: "identity-1" };
    const adapter = new HttpUserQuestionAdapter("http://daemon", () => access);
    await adapter.list({ sessionId: "session-1" });
    access = { authToken: "second-token", identityKey: "identity-2" };
    await adapter.list({ sessionId: "session-1" });
    expect(fetch.mock.calls[0]?.[1].headers.Authorization).toBe("Bearer first-token");
    expect(fetch.mock.calls[1]?.[1].headers.Authorization).toBe("Bearer second-token");
    expect(JSON.stringify(adapter)).not.toContain("second-token");
  });

  it("normalizes the accepted mutation and sends exact revision/token/answer", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({ schema_version: "user_question.v1", question: { ...metadata, state: "resolved" }, status: "accepted" }, 202)
    );
    vi.stubGlobal("fetch", fetch);
    const token = "a".repeat(32);
    await new HttpUserQuestionAdapter("http://daemon").resolve(
      "question-1",
      { sessionId: "session-1", runId: "run-1" },
      3,
      token,
      { kind: "short_text", text: "plain answer" }
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(fetch.mock.calls[0]?.[1].body as string)).toEqual({
      expected_revision: 3,
      mutation_token: token,
      answer: { kind: "short_text", text: "plain answer" },
    });
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [422, "invalid"],
  ] as const)("normalizes HTTP %s as %s without exposing response text", async (status, kind) => {
    const token = "b".repeat(32);
    const answer = "private-answer";
    const fetch = vi.fn().mockResolvedValue(
      response({ error: { code: "safe_code", message: `${token}:${answer}` } }, status)
    );
    vi.stubGlobal("fetch", fetch);
    const operation = new HttpUserQuestionAdapter("http://daemon").resolve(
      "question-1",
      { sessionId: "session-1", runId: "run-1" },
      3,
      token,
      { kind: "short_text", text: answer }
    );
    await expect(operation).rejects.toMatchObject({ kind, status });
    await expect(operation).rejects.toBeInstanceOf(UserQuestionHttpError);
    try {
      await operation;
    } catch (error) {
      expect(String(error)).not.toContain(token);
      expect(String(error)).not.toContain(answer);
    }
  });

  it("rejects stale/non-hex mutation proofs before network I/O", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      new HttpUserQuestionAdapter("http://daemon").cancel(
        "question-1",
        { sessionId: "session-1", runId: "run-1" },
        -1,
        "not-a-token"
      )
    ).rejects.toMatchObject({ status: 422, kind: "invalid" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normalizes an aborted fetch without retaining secrets", async () => {
    const fetch = vi.fn().mockRejectedValue(Object.assign(new Error("private-answer"), { name: "AbortError" }));
    vi.stubGlobal("fetch", fetch);
    const token = "c".repeat(32);
    await expect(
      new HttpUserQuestionAdapter("http://daemon").get(
        "question-1",
        { sessionId: "session-1", runId: "run-1" },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ kind: "aborted", status: 0 });
    expect(String(token)).not.toContain(String(new UserQuestionHttpError(0, "aborted")));
  });
});
