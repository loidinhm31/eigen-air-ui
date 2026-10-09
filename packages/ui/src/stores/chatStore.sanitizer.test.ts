// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "@eigen-air-ui/shared/constants";
import type { ChatMessage } from "@eigen-air-ui/shared/types";
import { useChatStore } from "./chatStore.js";

function seedStorage(messages: unknown[], version = 1) {
  localStorage.setItem(
    STORAGE_KEYS.CHAT_MESSAGES,
    JSON.stringify({ state: { messages }, version })
  );
}

function storedMessages(): Record<string, unknown>[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEYS.CHAT_MESSAGES) ?? "{}").state.messages;
}

describe("chatStore persisted-message whitelist", () => {
  beforeEach(() => {
    localStorage.clear();
    useChatStore.setState({ messages: [], messageRevision: 0 });
  });

  it("drops forged attachment, URL, blob and tool fields on restore and rewrites storage", async () => {
    seedStorage([
      {
        id: "msg-1",
        run_id: "run-1",
        role: "assistant",
        content: "answer",
        attachments: [{ artifact_id: "a1", url: "https://evil.example/x.png" }],
        images: ["blob:https://app/forged"],
        object_url: "blob:https://app/forged-2",
        artifact_ids: ["a2"],
        tool_calls: [{ id: "t1", name: "local_image", arguments: {} }],
        tool_call_id: "t1",
        debug: { provider: "p", model: "m", system_prompt: "secret-prompt" },
      },
    ]);

    await useChatStore.persist.rehydrate();

    expect(useChatStore.getState().messages).toEqual([
      { id: "msg-1", run_id: "run-1", role: "assistant", content: "answer" },
    ]);
    const raw = localStorage.getItem(STORAGE_KEYS.CHAT_MESSAGES) ?? "";
    for (const forged of [
      "evil.example",
      "blob:",
      "attachments",
      "artifact_ids",
      "secret-prompt",
    ]) {
      expect(raw).not.toContain(forged);
    }
    expect(storedMessages()[0]).toEqual(useChatStore.getState().messages[0]);
  });

  it("restores only the whitelisted keys even when the stored shape is hostile", async () => {
    seedStorage([
      // `__proto__` own key from JSON must not leak into the restored message.
      JSON.parse(
        '{"role":"user","content":"hi","__proto__":{"attachments":["x"]},"constructor":1}'
      ),
      "string",
      [],
      null,
    ]);

    await useChatStore.persist.rehydrate();

    const [message] = useChatStore.getState().messages as (ChatMessage & Record<string, unknown>)[];
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(Object.keys(message ?? {}).sort()).toEqual(["content", "role"]);
    expect(Object.getPrototypeOf(message)).toBe(Object.prototype);
    expect((message as Record<string, unknown>).attachments).toBeUndefined();
  });

  it("drops invalid optional ids but keeps the message; drops oversize or ill-typed messages", async () => {
    seedStorage([
      { id: 42, run_id: "", role: "assistant", content: "numeric id" },
      { id: "x".repeat(513), run_id: "r".repeat(513), role: "assistant", content: "long ids" },
      { id: { nested: "obj" }, run_id: ["run-1"], role: "user", content: "object ids" },
      { role: "assistant", content: "x".repeat(256 * 1024 + 1) },
      { role: "tool", content: "tool role", tool_call_id: "t1" },
      { role: "assistant", content: 7 },
      { role: "assistant" },
      { content: "no role" },
    ]);

    await useChatStore.persist.rehydrate();

    expect(useChatStore.getState().messages).toEqual([
      { role: "assistant", content: "numeric id" },
      { role: "assistant", content: "long ids" },
      { role: "user", content: "object ids" },
    ]);
  });

  it("keeps a run_id binding at the size limit (exact value, untouched)", async () => {
    const runId = "r".repeat(512);
    seedStorage([{ run_id: runId, role: "assistant", content: "ok" }]);

    await useChatStore.persist.rehydrate();

    expect(useChatStore.getState().messages[0]?.run_id).toBe(runId);
  });

  it("applies the same whitelist when writing: extra in-memory fields never reach storage", () => {
    const forged = {
      id: "msg-2",
      run_id: "run-2",
      role: "assistant",
      content: "visible",
      attachments: [{ artifact_id: "a1" }],
      tool_calls: [{ id: "t1", name: "n" }],
    } as unknown as ChatMessage;

    useChatStore.getState().replaceMessages([forged]);

    expect(storedMessages()).toEqual([
      { id: "msg-2", run_id: "run-2", role: "assistant", content: "visible" },
    ]);
    expect(localStorage.getItem(STORAGE_KEYS.CHAT_MESSAGES)).not.toContain("attachments");
    // In-memory state is untouched: only the persistence boundary filters.
    expect(
      (useChatStore.getState().messages[0] as unknown as Record<string, unknown>).tool_calls
    ).toBeDefined();
  });

  it("scrubs forged payloads written by an older version through migrate as well", async () => {
    seedStorage([{ role: "assistant", content: "legacy", attachments: ["x"] }], 0);

    await useChatStore.persist.rehydrate();

    expect(useChatStore.getState().messages).toEqual([{ role: "assistant", content: "legacy" }]);
    expect(localStorage.getItem(STORAGE_KEYS.CHAT_MESSAGES)).not.toContain("attachments");
  });

  // Decision (M7): persisted chat is an untrusted hint; history is refetched from the server on
  // load and the chat UI has no consumer of persisted `tool_calls`/`tool_call_id`. A restored
  // message therefore only needs role/content/id/run_id; dropping the rest is intentional.
  it("drops persisted tool-call fields on restore: restored messages are only role/content/id/run_id", async () => {
    seedStorage([
      {
        id: "m1",
        run_id: "run-1",
        role: "assistant",
        content: "calling a tool",
        tool_calls: [{ id: "call-1", type: "function", function: { name: "x", arguments: "{}" } }],
        tool_call_id: "call-1",
        debug: { prompt: "secret" },
      },
      { id: "m2", role: "user", content: "hi" },
    ]);

    await useChatStore.persist.rehydrate();

    const restored = useChatStore.getState().messages;
    expect(restored).toEqual([
      { id: "m1", run_id: "run-1", role: "assistant", content: "calling a tool" },
      { id: "m2", role: "user", content: "hi" },
    ]);
    for (const message of restored) {
      expect(
        Object.keys(message).every((key) => ["id", "run_id", "role", "content"].includes(key))
      ).toBe(true);
    }
    const raw = localStorage.getItem(STORAGE_KEYS.CHAT_MESSAGES) ?? "";
    for (const dropped of ["tool_calls", "tool_call_id", "call-1", "secret"]) {
      expect(raw).not.toContain(dropped);
    }
  });

  it("gives ChatMessage no attachment field (frozen decision: server listing is the only authority)", () => {
    const message: ChatMessage = { role: "assistant", content: "x" };
    // @ts-expect-error ChatMessage has no attachment field; adding one is a contract change.
    message.attachments = [];
    expect(message.role).toBe("assistant");
  });
});
