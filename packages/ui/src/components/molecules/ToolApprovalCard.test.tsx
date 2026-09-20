// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolApprovalSnapshot } from "@nonclaw-ui/shared/types";
import { ToolApprovalCard, type ToolApprovalCardProps } from "./ToolApprovalCard.js";

afterEach(cleanup);

const sampleProgramSnapshot: ToolApprovalSnapshot = {
  approval_id: "app-1",
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
    program: "cat",
    args_count: 2,
    working_dir: "workspace_root",
  },
  binding_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  revision: 1,
  created_at_ms: 1000,
  expires_at_ms: 2000,
  terminal_at_ms: null,
  terminal_code: null,
  decision_by_credential_id: null,
  redaction: "metadata_only",
};

const sampleTemplateSnapshot: ToolApprovalSnapshot = {
  ...sampleProgramSnapshot,
  approval_id: "app-2",
  tool_name: "deploy_skill",
  operation: "execute_template",
  safe_summary: {
    tool_name: "deploy_skill",
    template_preview: "helm upgrade {{release}}",
    param_names: ["release"],
    working_dir: "workspace_root",
  },
};

function baseProps(overrides: Partial<ToolApprovalCardProps> = {}): ToolApprovalCardProps {
  return {
    approval: sampleProgramSnapshot,
    onAllowOnce: vi.fn(),
    onDeny: vi.fn(),
    ...overrides,
  };
}

describe("ToolApprovalCard", () => {
  it("renders heading, operation, risk, boundary copy, and program summary", () => {
    render(<ToolApprovalCard {...baseProps()} />);

    expect(screen.getByRole("heading", { name: "Tool approval required" })).toBeTruthy();
    expect(screen.getByText("shell.execute")).toBeTruthy();
    expect(screen.getByText("Risk: High")).toBeTruthy();
    expect(
      screen.getByText("Allow Once authorizes one attempt of this exact operation. Deny rejects it.")
    ).toBeTruthy();

    expect(screen.getByText("cat")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("workspace_root")).toBeTruthy();

    // Sensitive internal fields never rendered
    expect(screen.queryByText("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")).toBeNull();
    expect(screen.queryByText("tenant-1")).toBeNull();
    expect(screen.queryByText("user-1")).toBeNull();
  });

  it("renders template summary fields correctly", () => {
    render(<ToolApprovalCard {...baseProps({ approval: sampleTemplateSnapshot })} />);

    expect(screen.getByText("deploy_skill.execute_template")).toBeTruthy();
    expect(screen.getByText("helm upgrade {{release}}")).toBeTruthy();
    expect(screen.getByText("release")).toBeTruthy();
    expect(screen.getByText("workspace_root")).toBeTruthy();
  });

  it("renders hostile strings as inert text without raw HTML execution", () => {
    const hostileSnapshot: ToolApprovalSnapshot = {
      ...sampleProgramSnapshot,
      safe_summary: {
        program: '<script>alert("xss")</script>',
        args_count: 0,
        working_dir: '<img src="x" onerror="alert(1)">',
      },
    };
    render(<ToolApprovalCard {...baseProps({ approval: hostileSnapshot })} />);

    expect(screen.getByText('<script>alert("xss")</script>')).toBeTruthy();
    expect(screen.getByText('<img src="x" onerror="alert(1)">')).toBeTruthy();
  });

  it("triggers onAllowOnce and onDeny when clicked", async () => {
    const onAllowOnce = vi.fn();
    const onDeny = vi.fn();
    render(<ToolApprovalCard {...baseProps({ onAllowOnce, onDeny })} />);

    const user = userEvent.setup();
    const allowButton = screen.getByRole("button", { name: "Allow Once" });
    const denyButton = screen.getByRole("button", { name: "Deny" });

    // Neither button is auto-focused
    expect(document.activeElement).not.toBe(allowButton);
    expect(document.activeElement).not.toBe(denyButton);

    await user.click(allowButton);
    expect(onAllowOnce).toHaveBeenCalledTimes(1);

    await user.click(denyButton);
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons when submitting, reconciling, offline, accepted, or disabled", () => {
    const { rerender } = render(<ToolApprovalCard {...baseProps({ submitting: true })} />);
    expect(screen.getByRole("button", { name: "Allow Once" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Deny" }).hasAttribute("disabled")).toBe(true);

    rerender(<ToolApprovalCard {...baseProps({ reconciling: true })} />);
    expect(screen.getByRole("button", { name: "Allow Once" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Deny" }).hasAttribute("disabled")).toBe(true);

    rerender(<ToolApprovalCard {...baseProps({ offline: true })} />);
    expect(screen.getByRole("button", { name: "Allow Once" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Deny" }).hasAttribute("disabled")).toBe(true);

    rerender(<ToolApprovalCard {...baseProps({ accepted: true })} />);
    expect(screen.getByRole("button", { name: "Allow Once" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Deny" }).hasAttribute("disabled")).toBe(true);

    rerender(<ToolApprovalCard {...baseProps({ disabled: true })} />);
    expect(screen.getByRole("button", { name: "Allow Once" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Deny" }).hasAttribute("disabled")).toBe(true);
  });

  it("renders alert role on error message", () => {
    render(<ToolApprovalCard {...baseProps({ error: "Approval changed or was already resolved" })} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Approval changed or was already resolved");
  });
});
