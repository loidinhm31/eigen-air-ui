import { describe, expect, it } from "vitest";
import type { ImageArtifactRef } from "@eigen-air-ui/shared/types";
import { bindImageGroupsToMessages, groupImageArtifactsByRun } from "./image-run-groups.js";

const art = (id: string, run: string, over: Partial<ImageArtifactRef> = {}): ImageArtifactRef => ({
  schema: "image_artifact.v1",
  artifact_id: id,
  job_id: `job-${run}`,
  session_id: "s1",
  run_id: run,
  ordinal: 0,
  mime: "image/png",
  width: 256,
  height: 256,
  byte_size: 100,
  sha256: "a".repeat(64),
  created_at_ms: 1,
  state: "committed",
  ...over,
});
const ids = (items: readonly ImageArtifactRef[]) => items.map((a) => a.artifact_id);

describe("groupImageArtifactsByRun", () => {
  it("returns nothing for no artifacts", () => {
    expect(groupImageArtifactsByRun([])).toEqual([]);
  });

  it("orders groups by earliest created_at_ms (ties by run id) regardless of input order", () => {
    const groups = groupImageArtifactsByRun([
      art("c", "r3", { created_at_ms: 50 }),
      art("b", "r2", { created_at_ms: 10 }),
      art("a2", "r1", { created_at_ms: 90 }),
      art("a1", "r1", { created_at_ms: 5, ordinal: 1 }),
      art("d", "r0", { created_at_ms: 10 }),
    ]);
    expect(groups.map((g) => g.runId)).toEqual(["r1", "r0", "r2", "r3"]);
  });

  it("orders items by job (earliest first) then ordinal and collects job and tool-call ids", () => {
    const [group] = groupImageArtifactsByRun([
      art("late-1", "r1", { job_id: "jA", ordinal: 1, created_at_ms: 30, tool_call_id: "tc2" }),
      art("early-1", "r1", { job_id: "jZ", ordinal: 1, created_at_ms: 10, tool_call_id: "tc1" }),
      art("late-0", "r1", { job_id: "jA", ordinal: 0, created_at_ms: 30, tool_call_id: "tc2" }),
      art("early-0", "r1", { job_id: "jZ", ordinal: 0, created_at_ms: 10, tool_call_id: "tc1" }),
      art("tmpl", "r1", { job_id: "jM", ordinal: 0, created_at_ms: 20 }),
    ]);
    expect(ids(group!.items)).toEqual(["early-0", "early-1", "tmpl", "late-0", "late-1"]);
    expect(group!.jobIds).toEqual(["jZ", "jM", "jA"]);
    expect(group!.toolCallIds).toEqual(["tc1", "tc2"]);
    expect(group!.sessionId).toBe("s1");
  });

  it("keeps the first of duplicate artifact ids and does not mutate or alias the input", () => {
    const input = [
      art("a", "r1", { width: 256 }),
      art("a", "r1", { width: 512 }),
      art("b", "r1", { ordinal: 1 }),
    ];
    const snapshot = structuredClone(input);
    const groups = groupImageArtifactsByRun(input);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((a) => [a.artifact_id, a.width])).toEqual([
      ["a", 256],
      ["b", 256],
    ]);
    expect(input).toEqual(snapshot);
    expect(groupImageArtifactsByRun(input)).toEqual(groups); // stable
  });

  it("never merges equal run ids from different sessions", () => {
    const groups = groupImageArtifactsByRun([art("a", "r1"), art("b", "r1", { session_id: "s2" })]);
    expect(groups.map((g) => [g.sessionId, g.runId])).toEqual([
      ["s1", "r1"],
      ["s2", "r1"],
    ]);
  });
});

describe("bindImageGroupsToMessages", () => {
  const groups = groupImageArtifactsByRun([
    art("a", "r1", { created_at_ms: 1 }),
    art("b", "r2", { created_at_ms: 2 }),
    art("c", "r3", { created_at_ms: 3 }),
  ]);

  it("handles empty groups and empty messages", () => {
    expect(bindImageGroupsToMessages([], [])).toEqual({ bound: new Map(), unbound: [] });
    const result = bindImageGroupsToMessages(groups, []);
    expect(result.bound.size).toBe(0);
    expect(result.unbound).toEqual(groups);
  });

  it("binds by exact run_id to assistant messages only", () => {
    const result = bindImageGroupsToMessages(groups, [
      { role: "user", run_id: "r1" },
      { role: "assistant", run_id: "r1" },
      { role: "tool", run_id: "r2" },
      { role: "assistant", run_id: "r3" },
    ]);
    expect([...result.bound.keys()]).toEqual([1, 3]);
    expect(result.bound.get(1)!.map((g) => g.runId)).toEqual(["r1"]);
    expect(result.bound.get(3)!.map((g) => g.runId)).toEqual(["r3"]);
    expect(result.unbound.map((g) => g.runId)).toEqual(["r2"]);
  });

  it("aborted turn: no assistant message => labelled unbound run group, nothing fabricated", () => {
    const result = bindImageGroupsToMessages(groups.slice(0, 1), [{ role: "user", run_id: "r1" }]);
    expect(result.bound.size).toBe(0);
    expect(result.unbound.map((g) => g.runId)).toEqual(["r1"]);
  });

  it("direct_template run (no chat message at all) stays unbound", () => {
    const direct = groupImageArtifactsByRun([art("t", "r-direct", { tool_call_id: undefined })]);
    const result = bindImageGroupsToMessages(direct, [{ role: "assistant", run_id: "other" }]);
    expect(result.unbound).toEqual(direct);
    expect(result.bound.size).toBe(0);
  });

  it("several assistant messages sharing a run_id bind to the LAST one", () => {
    const result = bindImageGroupsToMessages(groups.slice(0, 1), [
      { role: "assistant", run_id: "r1" },
      { role: "assistant", run_id: "r1" },
      { role: "assistant", run_id: "r1" },
    ]);
    expect([...result.bound.keys()]).toEqual([2]);
    expect(result.unbound).toEqual([]);
  });

  it("never binds by message id, partial/prefix run ids, or empty run ids", () => {
    const result = bindImageGroupsToMessages(groups.slice(0, 1), [
      { id: "r1", role: "assistant" },
      { role: "assistant", run_id: "r1 " },
      { role: "assistant", run_id: "R1" },
      { role: "assistant", run_id: "r" },
      { role: "assistant", run_id: "" },
    ]);
    expect(result.bound.size).toBe(0);
    expect(result.unbound).toHaveLength(1);
  });

  it("keeps group order when several groups bind to one message and does not mutate inputs", () => {
    const shared = groupImageArtifactsByRun([
      art("a", "r1", { created_at_ms: 1 }),
      art("b", "r1", { session_id: "s2", created_at_ms: 2 }),
    ]);
    const messages = [{ role: "assistant", run_id: "r1" }];
    const frozen = structuredClone(messages);
    const result = bindImageGroupsToMessages(shared, messages);
    expect(result.bound.get(0)!.map((g) => g.sessionId)).toEqual(["s1", "s2"]);
    expect(messages).toEqual(frozen);
    expect(bindImageGroupsToMessages(shared, messages)).toEqual(result);
  });
});
