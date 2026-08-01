// @vitest-environment jsdom
// @ts-expect-error Node test runtime provides fs; UI build intentionally has no Node types.
import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
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
    useRunInspectorStore.getState().clear();
  });

  it("does not serialize run state into persisted G1 stores or browser storage", () => {
    const before = persistedPresentationState();
    useRunInspectorStore.getState().snapshot({
      schema_version: 1,
      run: {
        run_id: "run-secret",
        trace_id: "trace",
        session_id: "session",
        root_run_id: "run-secret",
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
          plaintext: "debug-secret",
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
    expect(browserStorage).not.toMatch(/run-secret|debug-secret/);
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
