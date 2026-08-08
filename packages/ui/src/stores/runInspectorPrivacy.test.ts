// @vitest-environment jsdom
// @ts-expect-error Node test runtime provides fs; UI build intentionally has no Node types.
import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEYS } from "@nonclaw-ui/shared/constants";
import { useChatStore } from "./chatStore.js";
import { useConnectionStore } from "./connectionStore.js";
import { useRunInspectorStore } from "./runInspectorStore.js";

function persistedPresentationState(): string {
  return JSON.stringify({
    chat: useChatStore.getState(),
    connection: useConnectionStore.getState(),
  });
}

describe("run inspector privacy boundary", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    useChatStore.setState({
      messages: [],
      isStreaming: false,
      streamingContent: "",
      streamStatus: null,
      streamError: null,
    });
    useRunInspectorStore.getState().clear();
  });

  it("does not serialize run state into persisted G1 stores or browser storage", () => {
    const before = persistedPresentationState();
    useRunInspectorStore.getState().snapshot({
      schema_version: 1,
      run: {
        run_id: "run-fixture",
        trace_id: "trace",
        session_id: "session",
        root_run_id: "run-fixture",
        tenant_id: "tenant",
        user_id: "user",
        workspace_id: "workspace",
        agent_id: "agent",
        provider_id: "provider",
        channel: "web",
        lifecycle_status: "running",
        started_at_ms: 1,
        updated_at_ms: 1,
        snapshot_seq: 1,
        correlation_state: "correlated",
        redaction: {
          metadata_only: false,
          debug_requested: true,
          debug_available: true,
        },
      },
      events: [],
      tool_calls: [],
      memory_lineage: [],
      debug_excerpts: [
        {
          excerpt_seq: 1,
          kind: "provider_reasoning",
          plaintext: "debug-fixture",
          created_at_ms: 1,
          expires_at_ms: 99,
          plaintext_bytes: 12,
          truncated: false,
          redaction_count: 0,
        },
      ],
    });
    expect(persistedPresentationState()).toBe(before);
    const browserStorage = JSON.stringify({
      local: Object.keys(localStorage).map((key) => localStorage.getItem(key)),
      session: Object.keys(sessionStorage).map((key) => sessionStorage.getItem(key)),
    });
    expect(browserStorage).not.toMatch(/run-fixture|debug-fixture/);
  });

  it("does not persist chat prompt or reasoning debug", () => {
    useChatStore.getState().replaceMessages([
      {
        role: "assistant",
        content: "visible answer",
        debug: {
          provider: "provider",
          model: "model",
          system_prompt: "prompt-fixture",
          reasoning: {
            requested: true,
            available: true,
            text: "reasoning-fixture",
          },
        },
      },
    ]);

    const persisted = localStorage.getItem(STORAGE_KEYS.CHAT_MESSAGES) ?? "";
    expect(persisted).toContain("visible answer");
    expect(persisted).not.toContain("prompt-fixture");
    expect(persisted).not.toContain("reasoning-fixture");
    expect(JSON.parse(persisted).state.messages[0].debug).toBeUndefined();
    expect(useChatStore.getState().messages[0]?.debug?.system_prompt).toBe("prompt-fixture");
  });

  it("sanitizes legacy chat debug during hydration and rewrites storage", async () => {
    localStorage.setItem(
      STORAGE_KEYS.CHAT_MESSAGES,
      JSON.stringify({
        state: {
          messages: [
            {
              role: "assistant",
              content: "legacy answer",
              debug: {
                provider: "provider",
                model: "model",
                system_prompt: "legacy-prompt-fixture",
                reasoning: {
                  requested: true,
                  available: true,
                  text: "legacy-reasoning-fixture",
                },
              },
            },
          ],
        },
        version: 0,
      })
    );

    await useChatStore.persist.rehydrate();

    expect(useChatStore.getState().messages[0]).toEqual({
      role: "assistant",
      content: "legacy answer",
    });
    const persisted = localStorage.getItem(STORAGE_KEYS.CHAT_MESSAGES) ?? "";
    expect(persisted).not.toContain("legacy-prompt-fixture");
    expect(persisted).not.toContain("legacy-reasoning-fixture");
    expect(JSON.parse(persisted).version).toBe(1);
    expect(JSON.parse(persisted).state.messages[0].debug).toBeUndefined();
  });

  it("scrubs same-version poisoned storage before hydration", async () => {
    localStorage.setItem(
      STORAGE_KEYS.CHAT_MESSAGES,
      JSON.stringify({
        state: {
          messages: [
            {
              role: "assistant",
              content: "poisoned answer",
              debug: {
                provider: "provider",
                model: "model",
                system_prompt: "poisoned-prompt-fixture",
              },
            },
          ],
        },
        version: 1,
      })
    );

    await useChatStore.persist.rehydrate();

    const persisted = localStorage.getItem(STORAGE_KEYS.CHAT_MESSAGES) ?? "";
    expect(useChatStore.getState().messages[0]?.debug).toBeUndefined();
    expect(persisted).not.toContain("poisoned-prompt-fixture");
    expect(JSON.parse(persisted).state.messages[0].debug).toBeUndefined();
  });

  it("filters malformed messages before they reach the chat UI", async () => {
    localStorage.setItem(
      STORAGE_KEYS.CHAT_MESSAGES,
      JSON.stringify({
        state: {
          messages: [
            null,
            { role: "tool", content: "unsupported role" },
            { role: "assistant", content: 42 },
            { role: "assistant", content: "valid answer" },
          ],
        },
        version: 1,
      })
    );

    await useChatStore.persist.rehydrate();

    expect(useChatStore.getState().messages).toEqual([
      { role: "assistant", content: "valid answer" },
    ]);
  });

  it("has no service-worker, cache, IndexedDB, history, replay, or telemetry ingress", () => {
    const sources = [
      "chatStore.ts",
      "debugSettingsStore.ts",
      "connectionStore.ts",
      "runInspectorStore.ts",
      "../adapters/ws/WsClient.ts",
      "../adapters/ws/WsChatAdapter.ts",
      "../adapters/http/HttpRunAdapter.ts",
      "../components/pages/RunsPage.tsx",
    ]
      .map((path) => new URL(path, import.meta.url))
      .filter((url) => existsSync(url))
      .map((url) => readFileSync(url, "utf8"))
      .join("\n");
    expect(sources).not.toMatch(/localStorage\.setItem\([^\n]*(?:run|debug_excerpts)/i);
    expect(sources).not.toMatch(
      /indexedDB|caches\.open|serviceWorker|history\.(?:pushState|replaceState)|errorTelemetry|replayBuffer/i
    );
  });
});
