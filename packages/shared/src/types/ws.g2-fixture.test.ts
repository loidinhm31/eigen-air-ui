// @ts-expect-error Node test runtime provides fs; browser package intentionally has no Node types.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test runtime provides crypto; browser package intentionally has no Node types.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { WsEvent } from "./ws.js";

interface Fixture {
  legacy: unknown[];
  enriched: unknown[];
  unsequenced_refetch: unknown[];
}

declare const process: { cwd(): string };

const fixture = JSON.parse(
  readFileSync(`${process.cwd()}/test-fixtures/contracts/g2-ws-v1-run-events.json`, "utf8")
) as Fixture;

const EVENT_NAMES = new Set(["run.started", "run.delta", "tool.started", "run.finished"]);

function decodeEvent(value: unknown): WsEvent {
  if (!value || typeof value !== "object") throw new Error("event must be an object");
  const frame = value as Record<string, unknown>;
  if (frame.type !== "event" || frame.version !== "v1") {
    throw new Error("invalid event envelope");
  }
  if (typeof frame.event !== "string" || !EVENT_NAMES.has(frame.event)) {
    throw new Error("unsupported fixture event");
  }
  if (!frame.payload || typeof frame.payload !== "object") {
    throw new Error("event payload must be an object");
  }
  const payload = frame.payload as Record<string, unknown>;
  if (frame.event === "run.started" && typeof payload.run_id !== "string") {
    throw new Error("run.started requires payload.run_id");
  }
  if (frame.event === "run.delta" && typeof payload.delta !== "string") {
    throw new Error("run.delta requires payload.delta");
  }
  if (
    frame.event === "tool.started" &&
    (typeof payload.id !== "string" ||
      typeof payload.name !== "string" ||
      !payload.args ||
      typeof payload.args !== "object")
  ) {
    throw new Error("tool.started payload is invalid");
  }
  if (
    frame.event === "run.finished" &&
    (typeof payload.content !== "string" || typeof payload.tool_calls_made !== "number")
  ) {
    throw new Error("run.finished payload is invalid");
  }
  return value as WsEvent;
}

describe("G2 Rust WS fixtures", () => {
  it("matches the Rust-generated canonical fixture payload", () => {
    const canonical = createHash("sha256").update(JSON.stringify(fixture)).digest("hex");
    expect(canonical).toBe("aaeb46e9f603ce0ff1e5baf4f114ecf6fb5db6711a9e8a491102c12bea50a24f");
  });

  it("decodes legacy omission and enriched correlation", () => {
    const legacy = fixture.legacy.map(decodeEvent);
    const enriched = fixture.enriched.map(decodeEvent);
    expect(legacy[0].run_id).toBeUndefined();
    expect(enriched[0]).toMatchObject({
      run_id: "run-1",
      event_id: "event-1",
      event_seq: 1,
    });
    expect(enriched[2].payload).toMatchObject({ tool_call_id: "tool-1" });
  });

  it("keeps unsequenced refetch explicit and omits forbidden debug material", () => {
    const unsequenced = fixture.unsequenced_refetch.map(decodeEvent);
    expect(unsequenced[0]).toMatchObject({
      payload: { snapshot_refetch_required: true },
    });
    for (const frame of [...fixture.legacy, ...fixture.enriched, ...fixture.unsequenced_refetch]) {
      expect(JSON.stringify(frame)).not.toMatch(
        /"(?:debug|ciphertext|nonce|key_version|plaintext)"/i
      );
    }
  });
});
