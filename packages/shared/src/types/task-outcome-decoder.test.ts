import { describe, expect, it } from "vitest";
import { decodeTaskOutcome } from "./task-outcome-decoder.js";

describe("decodeTaskOutcome", () => {
  const validPassedPayload = {
    schema_version: "task_outcome.v1",
    task_id: "task-test-1",
    checker_id: "research_artifact_checker",
    checker_version: "v1",
    artifact_path: "reports/research_result.json",
    artifact_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    status: "passed",
    reason: "valid",
    details: "All checks passed",
    evaluated_at_ms: 1727500000000,
  };

  it("decodes valid passed task outcome payload", () => {
    const decoded = decodeTaskOutcome(validPassedPayload);
    expect(decoded).not.toBeNull();
    expect(decoded?.schema_version).toBe("task_outcome.v1");
    expect(decoded?.task_id).toBe("task-test-1");
    expect(decoded?.status).toBe("passed");
    expect(decoded?.reason).toBe("valid");
    expect(decoded?.artifact_digest).toBe(validPassedPayload.artifact_digest);
  });

  it("decodes redacted passed task outcome payload under non-exact scope", () => {
    const redactedPassedPayload = {
      ...validPassedPayload,
      artifact_path: "[redacted]",
      artifact_digest: "",
      details: null,
    };
    const decoded = decodeTaskOutcome(redactedPassedPayload);
    expect(decoded).not.toBeNull();
    expect(decoded?.status).toBe("passed");
    expect(decoded?.reason).toBe("valid");
    expect(decoded?.artifact_path).toBe("[redacted]");
    expect(decoded?.artifact_digest).toBe("");
    expect(decoded?.details).toBeNull();
  });

  it("decodes valid failed task outcome payload", () => {
    const failedPayload = {
      ...validPassedPayload,
      status: "failed",
      reason: "schema_mismatch",
      details: "Missing answer array",
    };
    const decoded = decodeTaskOutcome(failedPayload);
    expect(decoded).not.toBeNull();
    expect(decoded?.status).toBe("failed");
    expect(decoded?.reason).toBe("schema_mismatch");
  });

  it("decodes valid error task outcome payload", () => {
    const errorPayload = {
      ...validPassedPayload,
      artifact_digest: "",
      status: "error",
      reason: "artifact_missing",
      details: "File not found",
    };
    const decoded = decodeTaskOutcome(errorPayload);
    expect(decoded).not.toBeNull();
    expect(decoded?.status).toBe("error");
    expect(decoded?.reason).toBe("artifact_missing");
  });

  it("rejects unknown extra fields (fail-closed)", () => {
    const payload = {
      ...validPassedPayload,
      unknown_field: "illegal",
    };
    expect(decodeTaskOutcome(payload)).toBeNull();
  });

  it("rejects wrong schema version", () => {
    const payload = {
      ...validPassedPayload,
      schema_version: "task_outcome.v2",
    };
    expect(decodeTaskOutcome(payload)).toBeNull();
  });

  it("rejects passed status with non-64-char digest", () => {
    const payload = {
      ...validPassedPayload,
      artifact_digest: "short",
    };
    expect(decodeTaskOutcome(payload)).toBeNull();
  });

  it("rejects invalid status enum", () => {
    const payload = {
      ...validPassedPayload,
      status: "bogus",
    };
    expect(decodeTaskOutcome(payload)).toBeNull();
  });

  it("rejects invalid reason enum", () => {
    const payload = {
      ...validPassedPayload,
      reason: "bogus_reason",
    };
    expect(decodeTaskOutcome(payload)).toBeNull();
  });

  it("rejects oversized task_id", () => {
    const payload = {
      ...validPassedPayload,
      task_id: "A".repeat(200),
    };
    expect(decodeTaskOutcome(payload)).toBeNull();
  });
});
