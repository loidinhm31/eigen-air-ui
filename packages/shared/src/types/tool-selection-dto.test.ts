import { describe, expect, it } from "vitest";
import type { RunEventDto, ToolSelectionDto } from "./api.js";

describe("ToolSelectionDto types and contracts", () => {
  it("represents exact-scope tool selection projection with name arrays", () => {
    const event: RunEventDto = {
      event_id: "evt-tool-sel-1",
      event_seq: 2,
      event_kind: "tool_selection",
      lifecycle_status: "running",
      occurred_at_ms: 1727500000000,
      tool_selection: {
        schema_version: "tool_selection.v1",
        effective_cap: 2,
        cap_source: "explicit_profile",
        checked_count: 6,
        eligible_count: 6,
        selected_count: 2,
        rejected_count: 4,
        required_count: 1,
        context_count: 1,
        optional_count: 2,
        global_count: 2,
        selected_total: 2,
        selected_omitted: 0,
        rejected_total: 4,
        rejected_omitted: 0,
        reason_counts: {
          required_selected: 1,
          context_selected: 1,
          budget_dropped: 4,
        },
        order_hash: "abcd1234ef567890",
        selected_tools: [
          { canonical_name: "market_quote", reason_code: "required_selected" },
          { canonical_name: "session_context", reason_code: "context_selected" },
        ],
        rejected_tools: [
          { canonical_name: "optional_tool_a", reason_code: "budget_dropped" },
          { canonical_name: "global_tool_b", reason_code: "budget_dropped" },
        ],
      },
    };

    expect(event.tool_selection?.schema_version).toBe("tool_selection.v1");
    expect(event.tool_selection?.effective_cap).toBe(2);
    expect(event.tool_selection?.selected_tools).toHaveLength(2);
    expect(event.tool_selection?.name_details_redacted).toBeUndefined();
  });

  it("represents redacted tool selection projection where tool names are omitted", () => {
    const event: RunEventDto = {
      event_id: "evt-tool-sel-2",
      event_seq: 3,
      event_kind: "tool_selection",
      occurred_at_ms: 1727500001000,
      tool_selection: {
        schema_version: "tool_selection.v1",
        effective_cap: 1,
        cap_source: "default",
        checked_count: 4,
        eligible_count: 3,
        selected_count: 1,
        rejected_count: 2,
        selected_total: 1,
        selected_omitted: 0,
        rejected_total: 2,
        rejected_omitted: 0,
        reason_counts: {
          global_selected: 1,
          budget_dropped: 2,
        },
        order_hash: "feedcafe12345678",
        name_details_redacted: true,
      },
    };

    expect(event.tool_selection?.name_details_redacted).toBe(true);
    expect(event.tool_selection?.selected_tools).toBeUndefined();
    expect(event.tool_selection?.rejected_tools).toBeUndefined();
    expect(event.tool_selection?.rejected_count).toBe(2);
  });

  it("allows safe fallback for unknown reason codes", () => {
    const sel: ToolSelectionDto = {
      schema_version: "tool_selection.v1",
      reason_counts: {
        custom_enterprise_rule: 3,
      },
      selected_tools: [
        { canonical_name: "custom_tool", reason_code: "custom_enterprise_rule" },
      ],
    };

    expect(sel.reason_counts?.custom_enterprise_rule).toBe(3);
    expect(sel.selected_tools?.[0].reason_code).toBe("custom_enterprise_rule");
  });
});
