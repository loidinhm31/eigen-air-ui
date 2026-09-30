import { describe, expect, it } from "vitest";
import { decodeToolSelection } from "./tool-selection-decoder.js";

describe("decodeToolSelection", () => {
  const validExactPayload = {
    schema_version: "tool_selection.v1",
    effective_cap: 2,
    cap_source: "provider_profile",
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
  };

  it("decodes valid exact-scope tool selection payload", () => {
    const decoded = decodeToolSelection(validExactPayload);
    expect(decoded).not.toBeNull();
    expect(decoded?.schema_version).toBe("tool_selection.v1");
    expect(decoded?.effective_cap).toBe(2);
    expect(decoded?.selected_tools).toHaveLength(2);
    expect(decoded?.selected_tools?.[0].canonical_name).toBe("market_quote");
    expect(decoded?.rejected_tools).toHaveLength(2);
    expect(decoded?.order_hash).toBe("abcd1234ef567890");
    expect(decoded?.name_details_redacted).toBeUndefined();
  });

  it("decodes valid redacted tool selection payload", () => {
    const redactedPayload = {
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
    };
    const decoded = decodeToolSelection(redactedPayload);
    expect(decoded).not.toBeNull();
    expect(decoded?.name_details_redacted).toBe(true);
    expect(decoded?.selected_tools).toBeUndefined();
    expect(decoded?.rejected_tools).toBeUndefined();
  });

  it("rejects unknown extra fields like raw_prompt (fail-closed)", () => {
    const payload = {
      ...validExactPayload,
      raw_prompt: "secret raw prompt must never be decoded",
    };
    expect(decodeToolSelection(payload)).toBeNull();
  });

  it("rejects wrong schema version", () => {
    const payload = {
      ...validExactPayload,
      schema_version: "tool_selection.v2",
    };
    expect(decodeToolSelection(payload)).toBeNull();
  });

  it("rejects malformed order_hash (number instead of string)", () => {
    const payload = {
      ...validExactPayload,
      order_hash: 12345,
    };
    expect(decodeToolSelection(payload)).toBeNull();
  });

  it("rejects details exceeding max count (> 32)", () => {
    const oversizedTools = [];
    for (let i = 0; i < 33; i++) {
      oversizedTools.push({ canonical_name: `tool_${i}`, reason_code: "global_selected" });
    }
    const payload = {
      ...validExactPayload,
      selected_tools: oversizedTools,
    };
    expect(decodeToolSelection(payload)).toBeNull();
  });

  it("rejects invalid canonical name in tool details", () => {
    const payload = {
      ...validExactPayload,
      selected_tools: [{ canonical_name: "", reason_code: "global_selected" }],
    };
    expect(decodeToolSelection(payload)).toBeNull();
  });

  it("rejects invalid reason code in tool details", () => {
    const payload = {
      ...validExactPayload,
      selected_tools: [{ canonical_name: "valid_tool", reason_code: "INVALID CODE WITH SPACES!" }],
    };
    expect(decodeToolSelection(payload)).toBeNull();
  });
});
