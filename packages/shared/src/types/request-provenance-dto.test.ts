import { describe, expect, it } from "vitest";
import type { RunEventDto } from "./api.js";
import { decodeRequestProvenance } from "./request-provenance-decoder.js";

describe("RequestProvenanceDto and decodeRequestProvenance", () => {
  it("decodes valid provenance with full exact-scope fields", () => {
    const raw = {
      schema_version: "request_provenance.v1",
      logical_request_id: "req-123",
      provider_id: "local_llama",
      provider_profile_id: "profile-alpha",
      provider_profile_revision: 1727500000,
      model: "qwen2.5-7b",
      selected_skill_id: "market_research",
      skill_content_revision: "rev-1.0",
      prompt_format_version: "eigen-air-prompt-v1",
      section_summaries: [
        {
          section: "identity",
          present: true,
          estimated_tokens: 50,
          origin: "estimate",
        },
        {
          section: "skill",
          present: true,
          estimated_tokens: 120,
          origin: "estimate",
        },
        {
          section: "workspace",
          present: false,
          origin: "estimate",
        },
      ],
    };

    const decoded = decodeRequestProvenance(raw);
    expect(decoded).not.toBeNull();
    expect(decoded?.schema_version).toBe("request_provenance.v1");
    expect(decoded?.logical_request_id).toBe("req-123");
    expect(decoded?.provider_id).toBe("local_llama");
    expect(decoded?.provider_profile_id).toBe("profile-alpha");
    expect(decoded?.provider_profile_revision).toBe(1727500000);
    expect(decoded?.model).toBe("qwen2.5-7b");
    expect(decoded?.selected_skill_id).toBe("market_research");
    expect(decoded?.skill_content_revision).toBe("rev-1.0");
    expect(decoded?.prompt_format_version).toBe("eigen-air-prompt-v1");
    expect(decoded?.section_summaries).toHaveLength(3);
    expect(decoded?.section_summaries[0].section).toBe("identity");
    expect(decoded?.section_summaries[0].present).toBe(true);
    expect(decoded?.section_summaries[0].estimated_tokens).toBe(50);
    expect(decoded?.section_summaries[2].present).toBe(false);
    expect(decoded?.section_summaries[2].estimated_tokens).toBeNull();

    const event: RunEventDto = {
      event_id: "evt-prov-1",
      event_seq: 1,
      event_kind: "request_provenance",
      occurred_at_ms: 1727500000000,
      request_provenance: decoded,
    };
    expect(event.request_provenance?.provider_id).toBe("local_llama");
  });

  it("decodes redacted tenant reader provenance where identifiers are null", () => {
    const raw = {
      schema_version: "request_provenance.v1",
      logical_request_id: "req-456",
      provider_id: "local_llama",
      provider_profile_id: null,
      provider_profile_revision: null,
      model: "qwen2.5-7b",
      selected_skill_id: null,
      skill_content_revision: null,
      prompt_format_version: "eigen-air-prompt-v1",
      section_summaries: [
        {
          section: "identity",
          present: true,
          estimated_tokens: 40,
          origin: "estimate",
        },
      ],
    };

    const decoded = decodeRequestProvenance(raw);
    expect(decoded).not.toBeNull();
    expect(decoded?.logical_request_id).toBe("req-456");
    expect(decoded?.provider_profile_id).toBeNull();
    expect(decoded?.provider_profile_revision).toBeNull();
    expect(decoded?.selected_skill_id).toBeNull();
    expect(decoded?.skill_content_revision).toBeNull();
    expect(decoded?.model).toBe("qwen2.5-7b");
  });

  it("decodes provenance with null model and no skill", () => {
    const raw = {
      schema_version: "request_provenance.v1",
      logical_request_id: "req-789",
      provider_id: "openai",
      prompt_format_version: "eigen-air-prompt-v1",
      section_summaries: [],
    };

    const decoded = decodeRequestProvenance(raw);
    expect(decoded).not.toBeNull();
    expect(decoded?.model).toBeNull();
    expect(decoded?.selected_skill_id).toBeNull();
    expect(decoded?.provider_profile_id).toBeNull();
  });

  it("rejects invalid schema version", () => {
    const raw = {
      schema_version: "request_provenance.v2",
      logical_request_id: "req-1",
      provider_id: "p1",
      prompt_format_version: "v1",
      section_summaries: [],
    };
    expect(decodeRequestProvenance(raw)).toBeNull();
  });

  it("rejects unknown arbitrary metadata keys (prevents prompt leaks)", () => {
    const raw = {
      schema_version: "request_provenance.v1",
      logical_request_id: "req-1",
      provider_id: "p1",
      prompt_format_version: "v1",
      section_summaries: [],
      raw_prompt: "SECRET SYSTEM PROMPT BODY",
    };
    expect(decodeRequestProvenance(raw)).toBeNull();
  });

  it("rejects unknown section names in section summaries", () => {
    const raw = {
      schema_version: "request_provenance.v1",
      logical_request_id: "req-1",
      provider_id: "p1",
      prompt_format_version: "v1",
      section_summaries: [
        {
          section: "arbitrary_custom_section",
          present: true,
          origin: "estimate",
        },
      ],
    };
    expect(decodeRequestProvenance(raw)).toBeNull();
  });

  it("rejects oversized identifier fields", () => {
    const raw = {
      schema_version: "request_provenance.v1",
      logical_request_id: "A".repeat(200),
      provider_id: "p1",
      prompt_format_version: "v1",
      section_summaries: [],
    };
    expect(decodeRequestProvenance(raw)).toBeNull();
  });
});
