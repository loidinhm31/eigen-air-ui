// @ts-expect-error Node test runtime provides fs; browser package intentionally has no Node types.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test runtime provides crypto; browser package intentionally has no Node types.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  classifyTaskProgressUpdate,
  decodeTaskProgressSnapshot,
  decodeTaskProgressWsEvent,
} from "./task-progress-decoder.js";

declare const process: { cwd(): string };

type Cursor = { artifact_event_seq: number; artifact_revision: number; snapshot_seq: number };
interface Fixture {
  backward: Cursor[];
  duplicate: Cursor[];
  enriched: unknown[];
  gap: Cursor[];
  legacy: unknown[];
  malformed: unknown[];
  reorder: Cursor[];
  rest_replacement: unknown[];
  rest_zero_state: unknown[];
  unsequenced_refetch: unknown[];
  unknown_schema: unknown[];
  valid_states: unknown[];
  zero_state: unknown[];
}

const bytes = readFileSync(`${process.cwd()}/test-fixtures/contracts/g6-task-progress-v1.json`);
const fixture = JSON.parse(bytes.toString("utf8")) as Fixture;

function sequencedEvent(cursor: Cursor): unknown {
  const base = fixture.enriched[0] as { payload: Record<string, unknown> } & Record<
    string,
    unknown
  >;
  return {
    ...base,
    event_seq: cursor.snapshot_seq,
    payload: { ...base.payload, ...cursor },
  };
}

describe("G6 Rust task-progress fixture", () => {
  it("pins the exact backend-generated fixture bytes", () => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "f7ea148def5ed5c2aa40fe595553f197260c0c09d0b65e2e5b28b85137ebe01c"
    );
  });

  it("decodes sequenced metadata-only updates and valid additive states", () => {
    const first = decodeTaskProgressWsEvent(fixture.enriched[0]);
    expect(first).toMatchObject({
      event: "task_progress.updated",
      event_seq: 12,
      payload: {
        snapshot_seq: 12,
        projection_status: "running",
        verification_status: "unverified",
      },
    });
    expect(
      fixture.valid_states
        .map(decodeTaskProgressWsEvent)
        .map((frame) => frame.payload.projection_status)
    ).toEqual(["blocked", "cancel_requested"]);
  });

  it("forces REST reconciliation for duplicate, backward, gap, and reorder vectors", () => {
    const current = { artifact_revision: 3, artifact_event_seq: 5, snapshot_seq: 12 };
    expect(
      classifyTaskProgressUpdate(
        current,
        decodeTaskProgressWsEvent(sequencedEvent(fixture.duplicate[0]))
      )
    ).toBe("ignore");
    for (const cursor of [fixture.backward[0], fixture.gap[0], fixture.reorder[0]]) {
      expect(
        classifyTaskProgressUpdate(current, decodeTaskProgressWsEvent(sequencedEvent(cursor)))
      ).toBe("refetch");
    }
  });

  it("accepts only the explicit unsequenced refetch shape", () => {
    const hint = decodeTaskProgressWsEvent(fixture.unsequenced_refetch[0]);
    expect(hint).toEqual({
      type: "event",
      version: "v1",
      event: "task_progress.updated",
      payload: expect.objectContaining({ snapshot_refetch_required: true }),
    });
    expect(hint.payload.snapshot_seq).toBeUndefined();
  });

  it("decodes authorized snapshots and rejects invalid wire payloads", () => {
    expect(decodeTaskProgressSnapshot(fixture.rest_zero_state[0])).toMatchObject({
      artifact_revision: 0,
      artifact_event_seq: 0,
      g2_snapshot_seq: 1,
    });
    expect(decodeTaskProgressSnapshot(fixture.rest_replacement[0]).redaction).toEqual({
      metadata_only: true,
      hidden_fields: ["claimed_items.label", "evidence"],
    });
    for (const invalid of [...fixture.legacy, ...fixture.malformed, ...fixture.unknown_schema]) {
      expect(() => decodeTaskProgressWsEvent(invalid)).toThrow();
    }
    expect(() => decodeTaskProgressWsEvent(fixture.zero_state[0])).not.toThrow();
  });
});
