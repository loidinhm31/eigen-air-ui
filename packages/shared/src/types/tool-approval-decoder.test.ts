import { describe, expect, it } from "vitest";
import {
  decodeToolApprovalDetailResponse,
  decodeToolApprovalEvent,
  decodeToolApprovalListResponse,
  decodeToolApprovalResolveMutation,
  decodeToolApprovalSafeSummary,
  decodeToolApprovalSnapshot,
  errorKindForToolApprovalStatus,
  ToolApprovalDecodeError,
  VALID_TERMINAL_CODES,
} from "./tool-approval-decoder.js";
import { decodeWsFrameJson } from "./user-question-decoder.js";

const samplePendingSnapshot = {
  approval_id: "44444444-4444-4444-8444-444444444444",
  schema_version: "tool_approval.v1",
  tenant_id: "tenant-1",
  user_id: "user-1",
  workspace_id: "workspace-1",
  session_id: "session-1",
  run_id: "run-1",
  tool_call_id: "call-1",
  ordinal: 1,
  tool_name: "shell",
  operation: "execute",
  risk: "high",
  state: "pending",
  safe_summary: {
    program: "ls",
    args_count: 1,
    working_dir: "workspace_root",
  },
  binding_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  revision: 1,
  created_at_ms: 1700000000000,
  expires_at_ms: 1700000900000,
  terminal_at_ms: null,
  terminal_code: null,
  decision_by_credential_id: null,
  redaction: "metadata_only",
};

const sampleTemplateSnapshot = {
  ...samplePendingSnapshot,
  approval_id: "55555555-5555-5555-8555-555555555555",
  tool_name: "shell_skill",
  operation: "execute_template",
  safe_summary: {
    tool_name: "shell_skill",
    template_preview: "echo hello {{name}}",
    param_names: ["name"],
    working_dir: "workspace_root",
  },
};

const sampleEvent = {
  type: "event",
  version: "v1",
  event: "tool_approval.updated",
  session_id: "session-1",
  run_id: "run-1",
  request_id: "request-1",
  event_id: "event-101",
  event_seq: 1,
  occurred_at_ms: 1700000000000,
  payload: {
    approval_id: "44444444-4444-4444-8444-444444444444",
    tool_call_id: "call-1",
    tool_name: "shell",
    state: "pending",
    revision: 1,
    redaction: "metadata_only",
  },
};

describe("Tool approval decoders", () => {
  describe("safe_summary decoding", () => {
    it("decodes valid program safe summary", () => {
      const summary = {
        program: "cat",
        args_count: 2,
        working_dir: "workspace_root",
      };
      expect(decodeToolApprovalSafeSummary(summary)).toEqual(summary);
    });

    it("decodes valid template safe summary", () => {
      const summary = {
        tool_name: "custom_skill",
        template_preview: "deploy --env={{env}}",
        param_names: ["env"],
        working_dir: "workspace_root",
      };
      expect(decodeToolApprovalSafeSummary(summary)).toEqual(summary);
    });

    it("rejects unknown keys in safe summary", () => {
      expect(() =>
        decodeToolApprovalSafeSummary({
          program: "ls",
          args_count: 0,
          working_dir: "workspace_root",
          extra: true,
        })
      ).toThrow(ToolApprovalDecodeError);
    });

    it("rejects forbidden redaction keys in safe summary", () => {
      expect(() =>
        decodeToolApprovalSafeSummary({
          program: "ls",
          args_count: 0,
          working_dir: "workspace_root",
          arguments: ["-la"],
        })
      ).toThrow(ToolApprovalDecodeError);

      expect(() =>
        decodeToolApprovalSafeSummary({
          tool_name: "shell",
          template_preview: "test",
          param_names: [],
          working_dir: "workspace_root",
          env: { SECRET: "xyz" },
        })
      ).toThrow(ToolApprovalDecodeError);
    });

    it("rejects summary exceeding 512 serialized bytes", () => {
      expect(() =>
        decodeToolApprovalSafeSummary({
          program: "a".repeat(500),
          args_count: 1,
          working_dir: "workspace_root",
        })
      ).toThrow(ToolApprovalDecodeError);
    });

    it("rejects template_preview exceeding 128 characters", () => {
      expect(() =>
        decodeToolApprovalSafeSummary({
          tool_name: "skill",
          template_preview: "x".repeat(129),
          param_names: [],
          working_dir: "workspace_root",
        })
      ).toThrow(ToolApprovalDecodeError);
    });

    it("rejects negative or non-integer args_count", () => {
      expect(() =>
        decodeToolApprovalSafeSummary({
          program: "ls",
          args_count: -1,
          working_dir: "workspace_root",
        })
      ).toThrow(ToolApprovalDecodeError);

      expect(() =>
        decodeToolApprovalSafeSummary({
          program: "ls",
          args_count: 1.5,
          working_dir: "workspace_root",
        })
      ).toThrow(ToolApprovalDecodeError);
    });

    it("rejects program with path separators or control characters", () => {
      expect(() =>
        decodeToolApprovalSafeSummary({
          program: "/bin/ls",
          args_count: 0,
          working_dir: "workspace_root",
        })
      ).toThrow(ToolApprovalDecodeError);

      expect(() =>
        decodeToolApprovalSafeSummary({
          program: "bin\\ls",
          args_count: 0,
          working_dir: "workspace_root",
        })
      ).toThrow(ToolApprovalDecodeError);

      expect(() =>
        decodeToolApprovalSafeSummary({
          program: "ls\u0000",
          args_count: 0,
          working_dir: "workspace_root",
        })
      ).toThrow(ToolApprovalDecodeError);
    });

    it("rejects absolute or path-traversal working directories", () => {
      expect(() =>
        decodeToolApprovalSafeSummary({
          program: "ls",
          args_count: 0,
          working_dir: "/etc",
        })
      ).toThrow(ToolApprovalDecodeError);

      expect(() =>
        decodeToolApprovalSafeSummary({
          program: "ls",
          args_count: 0,
          working_dir: "../outside",
        })
      ).toThrow(ToolApprovalDecodeError);

      expect(() =>
        decodeToolApprovalSafeSummary({
          program: "ls",
          args_count: 0,
          working_dir: "sub/../../outside",
        })
      ).toThrow(ToolApprovalDecodeError);

      expect(() =>
        decodeToolApprovalSafeSummary({
          program: "ls",
          args_count: 0,
          working_dir: "C:\\Windows",
        })
      ).toThrow(ToolApprovalDecodeError);
    });

    it("rejects duplicate or unsorted param_names", () => {
      expect(() =>
        decodeToolApprovalSafeSummary({
          tool_name: "skill",
          template_preview: "test",
          param_names: ["b", "a"], // unsorted
          working_dir: "workspace_root",
        })
      ).toThrow(ToolApprovalDecodeError);

      expect(() =>
        decodeToolApprovalSafeSummary({
          tool_name: "skill",
          template_preview: "test",
          param_names: ["a", "a"], // duplicate
          working_dir: "workspace_root",
        })
      ).toThrow(ToolApprovalDecodeError);
    });

    it("rejects bidi control characters in template preview or program", () => {
      expect(() =>
        decodeToolApprovalSafeSummary({
          program: "ls\u202E",
          args_count: 0,
          working_dir: "workspace_root",
        })
      ).toThrow(ToolApprovalDecodeError);

      expect(() =>
        decodeToolApprovalSafeSummary({
          tool_name: "skill",
          template_preview: "echo \u202Ereversed",
          param_names: [],
          working_dir: "workspace_root",
        })
      ).toThrow(ToolApprovalDecodeError);
    });
  });

  describe("snapshot decoding", () => {
    it("decodes valid pending snapshot with program summary", () => {
      const decoded = decodeToolApprovalSnapshot(samplePendingSnapshot);
      expect(decoded.approval_id).toBe("44444444-4444-4444-8444-444444444444");
      expect(decoded.state).toBe("pending");
      expect(decoded.risk).toBe("high");
      expect(decoded.redaction).toBe("metadata_only");
      expect(decoded.binding_digest).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      );
    });

    it("decodes valid snapshot with template summary", () => {
      const decoded = decodeToolApprovalSnapshot(sampleTemplateSnapshot);
      expect(decoded.approval_id).toBe("55555555-5555-5555-8555-555555555555");
      expect(decoded.tool_name).toBe("shell_skill");
    });

    it("rejects mismatched tool_name between snapshot and template summary", () => {
      expect(() =>
        decodeToolApprovalSnapshot({
          ...sampleTemplateSnapshot,
          tool_name: "mismatched_tool_name",
        })
      ).toThrow(ToolApprovalDecodeError);
    });

    it("decodes terminal snapshot with non-null terminal fields and valid code", () => {
      const terminalSnapshot = {
        ...samplePendingSnapshot,
        state: "consumed",
        terminal_at_ms: 1700000005000,
        terminal_code: "consumed",
        decision_by_credential_id: "cred-1",
      };
      const decoded = decodeToolApprovalSnapshot(terminalSnapshot);
      expect(decoded.state).toBe("consumed");
      expect(decoded.terminal_at_ms).toBe(1700000005000);
      expect(decoded.terminal_code).toBe("consumed");
      expect(decoded.decision_by_credential_id).toBe("cred-1");
    });

    it("rejects unknown terminal_code", () => {
      expect(() =>
        decodeToolApprovalSnapshot({
          ...samplePendingSnapshot,
          terminal_code: "unknown_terminal_code",
        })
      ).toThrow(ToolApprovalDecodeError);
    });

    it("rejects invalid binding_digest format", () => {
      expect(() =>
        decodeToolApprovalSnapshot({
          ...samplePendingSnapshot,
          binding_digest: "not-a-valid-hex-digest",
        })
      ).toThrow(ToolApprovalDecodeError);

      expect(() =>
        decodeToolApprovalSnapshot({
          ...samplePendingSnapshot,
          binding_digest: "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855", // uppercase
        })
      ).toThrow(ToolApprovalDecodeError);
    });

    it("rejects non-high risk", () => {
      expect(() =>
        decodeToolApprovalSnapshot({
          ...samplePendingSnapshot,
          risk: "low",
        })
      ).toThrow(ToolApprovalDecodeError);
    });

    it("rejects invalid state", () => {
      expect(() =>
        decodeToolApprovalSnapshot({
          ...samplePendingSnapshot,
          state: "unknown_state",
        })
      ).toThrow(ToolApprovalDecodeError);
    });

    it("rejects extra keys in snapshot", () => {
      expect(() =>
        decodeToolApprovalSnapshot({
          ...samplePendingSnapshot,
          extra_field: "disallowed",
        })
      ).toThrow(ToolApprovalDecodeError);
    });

    it("rejects forbidden redaction keys in snapshot", () => {
      expect(() =>
        decodeToolApprovalSnapshot({
          ...samplePendingSnapshot,
          raw_args: "rm -rf /",
        })
      ).toThrow(ToolApprovalDecodeError);
    });
  });

  describe("list and detail response decoding", () => {
    it("decodes valid list response", () => {
      const listResponse = {
        schema_version: "tool_approval.v1",
        approvals: [samplePendingSnapshot, sampleTemplateSnapshot],
        redaction: "metadata_only",
      };
      const decoded = decodeToolApprovalListResponse(listResponse);
      expect(decoded.approvals).toHaveLength(2);
      expect(decoded.schema_version).toBe("tool_approval.v1");
      expect(decoded.redaction).toBe("metadata_only");
    });

    it("rejects list response with duplicate approval_ids", () => {
      const listResponse = {
        schema_version: "tool_approval.v1",
        approvals: [samplePendingSnapshot, samplePendingSnapshot],
        redaction: "metadata_only",
      };
      expect(() => decodeToolApprovalListResponse(listResponse)).toThrow(
        ToolApprovalDecodeError
      );
    });

    it("rejects list response exceeding 100 items", () => {
      const approvals = Array.from({ length: 101 }, (_, i) => ({
        ...samplePendingSnapshot,
        approval_id: `id-${i}`,
      }));
      expect(() =>
        decodeToolApprovalListResponse({
          schema_version: "tool_approval.v1",
          approvals,
          redaction: "metadata_only",
        })
      ).toThrow(ToolApprovalDecodeError);
    });

    it("decodes valid detail response", () => {
      const detailResponse = {
        schema_version: "tool_approval.v1",
        approval: samplePendingSnapshot,
        redaction: "metadata_only",
      };
      const decoded = decodeToolApprovalDetailResponse(detailResponse);
      expect(decoded.approval.approval_id).toBe(samplePendingSnapshot.approval_id);
    });
  });

  describe("mutation decoding", () => {
    it("decodes valid allow_once mutation", () => {
      const decoded = decodeToolApprovalResolveMutation({
        expected_revision: 1,
        decision: "allow_once",
      });
      expect(decoded.expected_revision).toBe(1);
      expect(decoded.decision).toBe("allow_once");
    });

    it("decodes valid deny mutation", () => {
      const decoded = decodeToolApprovalResolveMutation({
        expected_revision: 2,
        decision: "deny",
      });
      expect(decoded.expected_revision).toBe(2);
      expect(decoded.decision).toBe("deny");
    });

    it("rejects mutation request with reason or extra keys", () => {
      expect(() =>
        decodeToolApprovalResolveMutation({
          expected_revision: 2,
          decision: "deny",
          reason: "not allowed in this UI",
        })
      ).toThrow(ToolApprovalDecodeError);
    });

    it("rejects invalid decisions like allow_always", () => {
      expect(() =>
        decodeToolApprovalResolveMutation({
          expected_revision: 1,
          decision: "allow_always",
        })
      ).toThrow(ToolApprovalDecodeError);
    });

    it("rejects negative revision", () => {
      expect(() =>
        decodeToolApprovalResolveMutation({
          expected_revision: -1,
          decision: "allow_once",
        })
      ).toThrow(ToolApprovalDecodeError);
    });
  });

  describe("event decoding", () => {
    it("decodes valid tool_approval.updated event", () => {
      const decoded = decodeToolApprovalEvent(sampleEvent);
      expect(decoded.event).toBe("tool_approval.updated");
      expect(decoded.payload.approval_id).toBe("44444444-4444-4444-8444-444444444444");
      expect(decoded.payload.state).toBe("pending");
      expect(decoded.session_id).toBe("session-1");
      expect(decoded.run_id).toBe("run-1");
    });

    it("decodes event with snapshot_refetch_required flag", () => {
      const eventWithRefetch = {
        ...sampleEvent,
        payload: {
          ...sampleEvent.payload,
          snapshot_refetch_required: true,
        },
      };
      const decoded = decodeToolApprovalEvent(eventWithRefetch);
      expect(decoded.payload.snapshot_refetch_required).toBe(true);
    });

    it("decodes event without optional envelope correlation fields", () => {
      const minimalEvent = {
        type: "event",
        version: "v1",
        event: "tool_approval.updated",
        payload: sampleEvent.payload,
      };
      const decoded = decodeToolApprovalEvent(minimalEvent);
      expect(decoded.event).toBe("tool_approval.updated");
      expect(decoded.event_seq).toBeUndefined();
      expect(decoded.occurred_at_ms).toBeUndefined();
    });

    it("rejects event with invalid payload state", () => {
      expect(() =>
        decodeToolApprovalEvent({
          ...sampleEvent,
          payload: {
            ...sampleEvent.payload,
            state: "bogus",
          },
        })
      ).toThrow(ToolApprovalDecodeError);
    });

    it("decodes via decodeWsFrameJson", () => {
      const frame = decodeWsFrameJson(JSON.stringify(sampleEvent));
      expect(frame).toBeDefined();
      expect(frame?.type).toBe("event");
      if (frame?.type === "event") {
        expect(frame.event).toBe("tool_approval.updated");
      }
    });

    it("drops malformed event in decodeWsFrameJson without throwing", () => {
      const malformed = {
        type: "event",
        event: "tool_approval.updated",
        payload: {
          approval_id: "xyz",
          state: "invalid_state",
        },
      };
      expect(decodeWsFrameJson(JSON.stringify(malformed))).toBeUndefined();
    });
  });

  describe("HTTP error mapping", () => {
    it("maps all relevant HTTP statuses to safe error kinds", () => {
      expect(errorKindForToolApprovalStatus(401)).toBe("unauthorized");
      expect(errorKindForToolApprovalStatus(403)).toBe("forbidden");
      expect(errorKindForToolApprovalStatus(404)).toBe("not_found");
      expect(errorKindForToolApprovalStatus(409)).toBe("conflict");
      expect(errorKindForToolApprovalStatus(422)).toBe("invalid");
      expect(errorKindForToolApprovalStatus(0)).toBe("aborted");
      expect(errorKindForToolApprovalStatus(500)).toBe("unavailable");
      expect(errorKindForToolApprovalStatus(503)).toBe("unavailable");
    });
  });
});
