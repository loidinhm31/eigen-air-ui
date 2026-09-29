import { describe, expect, it } from "vitest";
import type { RunEventDto } from "./api.js";
import {
  decodeMemoryOutcome,
  formatMemoryOutcomeReason,
  formatMemoryOutcomeState,
} from "./memory-outcome-decoder.js";

describe("MemoryOutcomeDto and decodeMemoryOutcome", () => {
  it("represents valid stored outcome with exact-scope episode reference", () => {
    const raw = {
      schema_version: "memory_outcome.v1",
      operation_id: "op-flush-1",
      operation_kind: "episode_flush",
      state: "stored",
      reason: "stored",
      episode_reference: "ep-stored-123",
      fact_count: 5,
    };

    const decoded = decodeMemoryOutcome(raw);
    expect(decoded).not.toBeNull();
    expect(decoded?.schema_version).toBe("memory_outcome.v1");
    expect(decoded?.operation_id).toBe("op-flush-1");
    expect(decoded?.operation_kind).toBe("episode_flush");
    expect(decoded?.state).toBe("stored");
    expect(decoded?.reason).toBe("stored");
    expect(decoded?.episode_reference).toBe("ep-stored-123");
    expect(decoded?.fact_count).toBe(5);

    const event: RunEventDto = {
      event_id: "evt-mem-1",
      event_seq: 1,
      event_kind: "memory_outcome",
      occurred_at_ms: 1727500000000,
      memory_outcome: decoded,
    };
    expect(event.memory_outcome?.state).toBe("stored");
  });

  it("represents stored outcome with zero facts", () => {
    const raw = {
      schema_version: "memory_outcome.v1",
      operation_id: "op-flush-zero",
      operation_kind: "episode_flush",
      state: "stored",
      reason: "stored",
      episode_reference: "ep-zero",
      fact_count: 0,
    };

    const decoded = decodeMemoryOutcome(raw);
    expect(decoded?.fact_count).toBe(0);
    expect(decoded?.state).toBe("stored");
  });

  it("represents redacted stored outcome without episode reference", () => {
    const raw = {
      schema_version: "memory_outcome.v1",
      operation_id: "op-flush-redacted",
      operation_kind: "episode_flush",
      state: "stored",
      reason: "stored",
      fact_count: 3,
    };

    const decoded = decodeMemoryOutcome(raw);
    expect(decoded).not.toBeNull();
    expect(decoded?.state).toBe("stored");
    expect(decoded?.episode_reference).toBeUndefined();
    expect(decoded?.fact_count).toBe(3);
  });

  it("decodes skipped outcomes correctly", () => {
    const sensitive = decodeMemoryOutcome({
      schema_version: "memory_outcome.v1",
      operation_id: "op-skip-1",
      operation_kind: "episode_flush",
      state: "skipped",
      reason: "sensitive_content",
    });
    expect(sensitive?.state).toBe("skipped");
    expect(sensitive?.reason).toBe("sensitive_content");
    expect(formatMemoryOutcomeReason("sensitive_content")).toBe(
      "Sensitive content detected",
    );

    const noIdentity = decodeMemoryOutcome({
      schema_version: "memory_outcome.v1",
      operation_id: "op-skip-2",
      operation_kind: "episode_flush",
      state: "skipped",
      reason: "no_identity",
    });
    expect(noIdentity?.reason).toBe("no_identity");

    const noResponse = decodeMemoryOutcome({
      schema_version: "memory_outcome.v1",
      operation_id: "op-skip-3",
      operation_kind: "episode_flush",
      state: "skipped",
      reason: "no_final_response",
    });
    expect(noResponse?.reason).toBe("no_final_response");
  });

  it("decodes write_failed outcomes with partial counts", () => {
    const failed = decodeMemoryOutcome({
      schema_version: "memory_outcome.v1",
      operation_id: "op-fail-1",
      operation_kind: "episode_flush",
      state: "failed",
      reason: "write_failed",
      episode_reference: "ep-partial",
      fact_count: 2,
    });
    expect(failed?.state).toBe("failed");
    expect(failed?.reason).toBe("write_failed");
    expect(failed?.episode_reference).toBe("ep-partial");
    expect(failed?.fact_count).toBe(2);
  });

  it("rejects arbitrary metadata keys", () => {
    const raw = {
      schema_version: "memory_outcome.v1",
      operation_id: "op-leak-1",
      operation_kind: "episode_flush",
      state: "stored",
      reason: "stored",
      episode_reference: "ep-123",
      fact_count: 1,
      unrelated_secret: "must_not_pass",
    };
    expect(decodeMemoryOutcome(raw)).toBeNull();
  });

  it("rejects invalid schema version or state-reason pairings", () => {
    expect(
      decodeMemoryOutcome({
        schema_version: "memory_outcome.v2",
        operation_id: "op-1",
        operation_kind: "episode_flush",
        state: "stored",
        reason: "stored",
      }),
    ).toBeNull();

    expect(
      decodeMemoryOutcome({
        schema_version: "memory_outcome.v1",
        operation_id: "op-1",
        operation_kind: "episode_flush",
        state: "skipped",
        reason: "stored",
      }),
    ).toBeNull();

    expect(
      decodeMemoryOutcome({
        schema_version: "memory_outcome.v1",
        operation_id: "op-1",
        operation_kind: "episode_flush",
        state: "unavailable",
        reason: "write_failed",
      }),
    ).toBeNull();
  });

  it("formats states and reasons predictably", () => {
    expect(formatMemoryOutcomeState("stored")).toBe("Stored");
    expect(formatMemoryOutcomeState("skipped")).toBe("Skipped");
    expect(formatMemoryOutcomeState("failed")).toBe("Failed");
    expect(formatMemoryOutcomeState("unavailable")).toBe("Unavailable");

    expect(formatMemoryOutcomeReason("stored")).toBe("Stored");
    expect(formatMemoryOutcomeReason("write_failed")).toBe("Write failed");
    expect(formatMemoryOutcomeReason("outcome_unavailable")).toBe("Outcome unavailable");
  });
});
