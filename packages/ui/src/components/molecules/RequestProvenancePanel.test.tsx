// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(() => cleanup());
import type { RunEventDto } from "@eigen-air-ui/shared/types";
import { RequestProvenancePanel } from "./RequestProvenancePanel.js";

function makeProvenanceEvent(
  provenanceOverrides: Partial<NonNullable<RunEventDto["request_provenance"]>> = {},
  eventOverrides: Partial<RunEventDto> = {},
): RunEventDto {
  return {
    event_id: "evt-prov-1",
    event_seq: 1,
    event_kind: "request_provenance",
    occurred_at_ms: 1727500000000,
    request_provenance: {
      schema_version: "request_provenance.v1",
      logical_request_id: "req-12345",
      provider_id: "local_llama",
      provider_profile_id: "profile-alpha",
      provider_profile_revision: 1727500000,
      model: "qwen2.5-7b",
      selected_skill_id: "market_research",
      skill_content_revision: "rev-1.0.0",
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
      ...provenanceOverrides,
    },
    ...eventOverrides,
  };
}

describe("RequestProvenancePanel", () => {
  it("renders unavailable state when no request provenance events exist", () => {
    render(<RequestProvenancePanel events={[]} />);

    expect(screen.getByRole("heading", { name: "Request provenance" })).toBeDefined();
    expect(
      screen.getByText("Request provenance unavailable (no provenance reported by server)."),
    ).toBeDefined();
    expect(screen.queryByText(/recorded/)).toBeNull();
  });

  it("renders full exact-scope provenance details and section summaries", () => {
    const event = makeProvenanceEvent();

    render(<RequestProvenancePanel events={[event]} />);

    expect(screen.getByText("1 recorded")).toBeDefined();
    expect(screen.getByText("request_provenance.v1")).toBeDefined();
    expect(screen.getByText("req req-12345")).toBeDefined();
    expect(screen.getByText(/local_llama/)).toBeDefined();
    expect(screen.getByText(/profile-alpha \(rev 1727500000\)/)).toBeDefined();
    expect(screen.getByText(/qwen2.5-7b/)).toBeDefined();
    expect(screen.getByText(/market_research \(rev-1.0.0\)/)).toBeDefined();
    expect(screen.getByText(/eigen-air-prompt-v1/)).toBeDefined();
    expect(screen.getByText(/identity \(~50t\)/)).toBeDefined();
    expect(screen.getByText(/skill \(~120t\)/)).toBeDefined();
  });

  it("renders redacted tenant reader provenance safely", () => {
    const event = makeProvenanceEvent({
      provider_profile_id: null,
      provider_profile_revision: null,
      selected_skill_id: null,
      skill_content_revision: null,
    });

    render(<RequestProvenancePanel events={[event]} />);

    expect(screen.getByText(/Redacted \/ Unknown/)).toBeDefined();
    expect(screen.getByText(/Unknown \/ Redacted/)).toBeDefined();
  });

  it("renders exact token origin without tilde prefix", () => {
    const event = makeProvenanceEvent({
      section_summaries: [
        {
          section: "identity",
          present: true,
          estimated_tokens: 50,
          origin: "exact",
        },
      ],
    });

    render(<RequestProvenancePanel events={[event]} />);

    expect(screen.getByText(/identity \(50t\)/)).toBeDefined();
  });
});
