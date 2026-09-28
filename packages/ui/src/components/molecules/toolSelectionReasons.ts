export const TOOL_SELECTION_REASON_LABELS: Record<string, string> = {
  cap_unset: "Cap unset",
  cap_zero: "Cap zero",
  budget_dropped: "Budget dropped",
  security_denied: "Security denied",
  context_unavailable: "Context unavailable",
  required_overflow: "Required tool budget overflow",
  required_selected: "Required selected",
  context_selected: "Context selected",
  optional_selected: "Optional selected",
  global_selected: "Global selected",
  duplicate_name: "Duplicate name",
  provider_unsupported: "Provider unsupported",
  retry_reused: "Retry reused",
};

export function formatToolReason(code?: string | null): string {
  if (!code) return "Unspecified";
  return TOOL_SELECTION_REASON_LABELS[code] ?? `Unknown reason (${code})`;
}
