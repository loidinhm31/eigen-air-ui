import type { RunExportDto } from "@eigen-air-ui/shared/types";

/** Formats only recorded evidence. Export plaintext never enters a store or browser storage. */
export function formatRunTextExport(
  snapshot: RunExportDto,
  includeDebug: boolean,
  disclosures: string[],
  now = Date.now()
): string {
  const { run, transcript } = snapshot;
  const lines = [
    "Eigen Air run text export",
    `Run ID: ${run.run_id}`,
    `Session ID: ${run.session_id}`,
    `Trace ID: ${run.trace_id}`,
    `Status: ${run.lifecycle_status}`,
    `Provider: ${run.provider_id}`,
    `Started at (ms): ${run.started_at_ms}`,
    `Completed at (ms): ${run.completed_at_ms ?? "Not recorded"}`,
    `Snapshot sequence: ${run.snapshot_seq}`,
    "Scope: exact run only; committed transcript and recorded metadata, not a raw generation capture.",
    "Pagination is read at export time; a running run may acquire more records after this export.",
    "",
    "=== Committed transcript ===",
  ];
  if (transcript?.unavailable_reason) lines.push(`Transcript unavailable: ${transcript.unavailable_reason}`);
  if (!transcript?.messages.length) {
    lines.push("No committed messages available for this run.");
    if (!transcript) lines.push("Transcript unavailable: server did not provide run-correlated text.");
  }
  if (transcript?.truncated) lines.push("TRUNCATED: committed transcript exceeded the server export bound.");
  for (const role of ["user", "assistant", "tool"]) {
    if (!(transcript?.messages ?? []).some((message) => message.role === role && message.content.length > 0)) {
      lines.push(`${role} text unavailable: no non-empty committed ${role} message available for this run.`);
    }
  }
  for (const [index, message] of (transcript?.messages ?? []).entries()) {
    lines.push(`\n[Message ${index + 1}: ${message.role}]`);
    if (message.tool_call_id) lines.push(`Tool call ID: ${message.tool_call_id}`);
    lines.push(message.content || "[No text content recorded]");
    for (const call of message.tool_calls ?? []) {
      lines.push(`Requested tool: ${call.name} · ID: ${call.id}`);
      lines.push(`Arguments: ${call.arguments === undefined ? "Unavailable" : JSON.stringify(call.arguments, null, 2)}`);
    }
  }
  lines.push("\n=== Recorded tool calls ===");
  if (!snapshot.tool_calls.length) lines.push("No tool call records available; this is not proof that no tool executed.");
  for (const tool of snapshot.tool_calls) {
    lines.push(`\nTool: ${tool.tool_name} · ID: ${tool.tool_call_id} · ordinal: ${tool.ordinal}`);
    lines.push(`Recorded status: ${tool.status} · policy: ${tool.policy_outcome ?? "Not recorded"}`);
    lines.push(`Started (ms): ${tool.started_at_ms} · completed (ms): ${tool.completed_at_ms ?? "Not recorded"}`);
    if (tool.safe_error_code) lines.push(`Error code: ${tool.safe_error_code}`);
  }
  lines.push("\n=== Recorded lifecycle events ===");
  if (!snapshot.events.length) lines.push("No event records available.");
  for (const event of snapshot.events) lines.push(JSON.stringify(event, null, 2));

  lines.push("\n=== Authorized debug excerpts / reasoning ===");
  const debug = includeDebug
    ? (snapshot.debug_excerpts ?? []).filter((excerpt) => excerpt.expires_at_ms > now)
    : [];
  if (!includeDebug) lines.push("Debug unavailable: not authorized (run:read:debug required); not requested.");
  else if (!debug.length) lines.push(`Debug unavailable: ${run.redaction.unavailable_reason ?? "not recorded or no unexpired excerpts available"}.`);
  if (!debug.some((excerpt) => excerpt.kind === "provider_reasoning" && excerpt.plaintext.length > 0)) {
    lines.push("Provider reasoning unavailable: no authorized, unexpired reasoning excerpt recorded. Thoughts are not inferred from the answer.");
  }
  if (includeDebug && (snapshot.debug_excerpts ?? []).some((excerpt) => excerpt.expires_at_ms <= now)) {
    lines.push("Expired debug excerpts omitted at download time.");
  }
  for (const excerpt of debug) {
    lines.push(`\n[${excerpt.kind} · sequence: ${excerpt.excerpt_seq} · expires (ms): ${excerpt.expires_at_ms}]`);
    lines.push(`Truncated: ${excerpt.truncated} · redactions: ${excerpt.redaction_count} · recorded bytes: ${excerpt.plaintext_bytes}`);
    lines.push(excerpt.plaintext || "[No text content recorded]");
  }
  lines.push("\n=== Availability / bounds ===");
  lines.push("Server redaction and retention policies apply. Missing content is not reconstructed.");
  lines.push(...disclosures);
  if (!disclosures.length) lines.push("All authorized advertised tool/event/debug pages read within the export bounds.");
  return `${lines.join("\n")}\n`;
}
