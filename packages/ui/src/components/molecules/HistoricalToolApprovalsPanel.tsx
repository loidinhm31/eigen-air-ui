import * as React from "react";
import type {
  ToolApprovalSnapshot,
  ToolApprovalSafeSummary,
  ToolApprovalProgramSafeSummary,
  ToolApprovalTemplateSafeSummary,
  RunToolCallDto,
} from "@eigen-air-ui/shared/types";
import { formatTimestamp, toolDurationText } from "../organisms/runInspectorFormatting.js";
import { Button } from "../atoms/Button.js";

export interface HistoricalToolApprovalsPanelProps {
  readonly approvals?: ToolApprovalSnapshot[];
  readonly toolCalls?: RunToolCallDto[];
  readonly hasMoreTools?: boolean;
  readonly isLoading?: boolean;
  readonly error?: string;
  readonly onRefresh?: () => void;
}

function isProgramSummary(
  summary: ToolApprovalSafeSummary
): summary is ToolApprovalProgramSafeSummary {
  return summary !== null && typeof summary === "object" && "program" in summary;
}

function isTemplateSummary(
  summary: ToolApprovalSafeSummary
): summary is ToolApprovalTemplateSafeSummary {
  return summary !== null && typeof summary === "object" && "template_preview" in summary;
}

export function formatDecisionState(
  state: ToolApprovalSnapshot["state"],
  decisionByCredentialId: string | null
): { label: string; detail: string } {
  const credentialText = decisionByCredentialId
    ? ` by ${decisionByCredentialId}`
    : "";
  switch (state) {
    case "approved_once":
    case "claimed":
    case "executing":
    case "consumed":
      return {
        label: "Accepted (allow_once)",
        detail: `Decision accepted${credentialText}`,
      };
    case "denied":
      return {
        label: "Denied",
        detail: `Decision denied${credentialText}`,
      };
    case "expired":
      return {
        label: "Expired",
        detail: "Pending approval TTL expired without decision",
      };
    case "cancelled":
      return {
        label: "Cancelled",
        detail: `Approval cancelled${credentialText}`,
      };
    case "indeterminate":
      return {
        label: "Accepted (indeterminate execution)",
        detail: `Decision was accepted${credentialText}; execution lease expired or container interrupted`,
      };
    case "pending":
    default:
      return {
        label: "Pending decision",
        detail: "Awaiting interactive decision",
      };
  }
}

export function formatExecutionLifecycle(state: ToolApprovalSnapshot["state"]): {
  label: string;
  detail: string;
} {
  switch (state) {
    case "pending":
      return {
        label: "Pending approval",
        detail: "No execution permit has been issued",
      };
    case "approved_once":
      return {
        label: "Approved (permit pending claim)",
        detail: "Permit issued; awaiting executor CAS claim",
      };
    case "claimed":
      return {
        label: "Claimed (lease active)",
        detail: "Executor acquired execution permit; execution pending",
      };
    case "executing":
      return {
        label: "Executing",
        detail: "Tool execution container started with active lease",
      };
    case "consumed":
      return {
        label: "Permit consumed",
        detail: "Permit consumed after tool execution started or reached terminal outcome",
      };
    case "indeterminate":
      return {
        label: "Indeterminate",
        detail: "Execution lease expired or process lost during run (indeterminate; no automatic retry)",
      };
    case "denied":
      return {
        label: "Not executed (denied)",
        detail: "Operation rejected by user decision",
      };
    case "expired":
      return {
        label: "Not executed (expired)",
        detail: "Operation expired before approval was submitted",
      };
    case "cancelled":
      return {
        label: "Not executed (cancelled)",
        detail: "Approval was cancelled before execution began",
      };
    default:
      return {
        label: state,
        detail: `Lifecycle state: ${state}`,
      };
  }
}

export function HistoricalToolApprovalsPanel({
  approvals = [],
  toolCalls = [],
  hasMoreTools = false,
  isLoading = false,
  error,
  onRefresh,
}: HistoricalToolApprovalsPanelProps) {
  return (
    <section aria-labelledby="run-approvals-heading">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 id="run-approvals-heading" className="text-sm font-semibold">
            Tool approvals
          </h3>
          {approvals.length > 0 && (
            <span className="text-muted-foreground text-xs">
              {approvals.length >= 100
                ? `${approvals.length} loaded, possibly incomplete`
                : `${approvals.length} recorded`}
            </span>
          )}
        </div>
        {onRefresh && (
          <Button
            size="sm"
            variant="outline"
            onClick={onRefresh}
            disabled={isLoading}
            className="text-xs h-7 px-2"
            aria-label="Refresh tool approvals"
          >
            {isLoading ? "Refreshing…" : "Refresh approvals"}
          </Button>
        )}
      </div>

      {isLoading && approvals.length === 0 && (
        <p className="text-muted-foreground mt-2 text-sm" role="status">
          Loading tool approvals…
        </p>
      )}

      {error && (
        <p className="mt-1 text-destructive text-xs">
          {error}
        </p>
      )}

      {!isLoading && approvals.length === 0 && !error && (
        <p className="text-muted-foreground mt-2 text-sm">
          No tool approvals recorded for this run.
        </p>
      )}

      {approvals.length > 0 && (
        <ul className="mt-2 space-y-3" aria-label="Tool approval records">
          {approvals.map((approval) => {
            const decisionInfo = formatDecisionState(
              approval.state,
              approval.decision_by_credential_id
            );
            const lifecycleInfo = formatExecutionLifecycle(approval.state);
            const matchingTool = toolCalls.find(
              (t) => t.tool_call_id === approval.tool_call_id
            );

            return (
              <li
                key={approval.approval_id}
                className="border-border space-y-2 rounded border p-3 text-xs"
                data-testid={`approval-record-${approval.approval_id}`}
              >
                {/* Header & Identifiers */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2">
                  <div className="space-y-0.5">
                    <p className="font-semibold text-sm">
                      {approval.tool_name}.{approval.operation}
                    </p>
                    <p className="text-muted-foreground font-mono text-[11px] break-all">
                      approval {approval.approval_id} · tool call {approval.tool_call_id} · ordinal{" "}
                      {approval.ordinal} · rev {approval.revision}
                    </p>
                  </div>
                  <span className="bg-muted text-muted-foreground rounded px-2 py-0.5 font-mono text-[11px]">
                    digest {approval.binding_digest.slice(0, 16)}…
                  </span>
                </div>

                {/* Safe summary (Preserved 512-byte user-approved field set) */}
                <div className="space-y-1 rounded bg-muted/40 p-2.5">
                  <p className="text-muted-foreground text-[11px] font-medium">Safe preview</p>
                  {isProgramSummary(approval.safe_summary) && (
                    <div className="space-y-0.5">
                      <div>
                        <span className="text-muted-foreground">Program: </span>
                        <span className="font-mono">{approval.safe_summary.program}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Argument count: </span>
                        <span>{approval.safe_summary.args_count}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Working directory: </span>
                        <span className="font-mono">{approval.safe_summary.working_dir}</span>
                      </div>
                    </div>
                  )}

                  {isTemplateSummary(approval.safe_summary) && (
                    <div className="space-y-0.5">
                      <div>
                        <span className="text-muted-foreground">Tool: </span>
                        <span>{approval.safe_summary.tool_name}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Template preview: </span>
                        <span className="font-mono">{approval.safe_summary.template_preview}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Parameter names: </span>
                        <span>
                          {approval.safe_summary.param_names.length > 0
                            ? approval.safe_summary.param_names.join(", ")
                            : "none"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Working directory: </span>
                        <span className="font-mono">{approval.safe_summary.working_dir}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Two independent evidence columns: G4 Approval Authority & G2 Observed Tool Authority */}
                <div className="grid gap-3 sm:grid-cols-2 pt-1">
                  {/* Column 1: Approval Decision & Execution Lifecycle (G4) */}
                  <div className="space-y-1.5 rounded border border-border/50 p-2.5">
                    <p className="font-semibold text-xs text-foreground">
                      Approval Authority (G4)
                    </p>
                    <div>
                      <span className="text-muted-foreground">Decision: </span>
                      <span className="font-medium">{decisionInfo.label}</span>
                      <p className="text-muted-foreground text-[11px]">{decisionInfo.detail}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Execution status: </span>
                      <span className="font-medium">{lifecycleInfo.label}</span>
                      <p className="text-muted-foreground text-[11px]">{lifecycleInfo.detail}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Permit state: </span>
                      <span className="font-medium">
                        {approval.state === "consumed"
                          ? "Permit consumed"
                          : approval.state === "claimed" || approval.state === "executing"
                            ? "Permit active / in-flight"
                            : approval.state === "approved_once"
                              ? "Permit issued (unclaimed)"
                              : "No permit issued"}
                      </span>
                      {approval.state === "consumed" && (
                        <p className="text-muted-foreground text-[11px]">
                          Note: Permit consumed indicates permit usage only; it does not imply tool execution success.
                        </p>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground pt-1 border-t border-border/30 space-y-0.5">
                      <p>Created: {formatTimestamp(approval.created_at_ms)}</p>
                      <p>Expires: {formatTimestamp(approval.expires_at_ms)}</p>
                      {approval.terminal_at_ms != null && (
                        <p>Terminal: {formatTimestamp(approval.terminal_at_ms)}</p>
                      )}
                      {approval.terminal_code && (
                        <p className="font-mono">Terminal code: {approval.terminal_code}</p>
                      )}
                    </div>
                  </div>

                  {/* Column 2: Observed Tool Result (G2) & Observed Effect */}
                  <div className="space-y-1.5 rounded border border-border/50 p-2.5">
                    <p className="font-semibold text-xs text-foreground">
                      Observed Tool Result (G2)
                    </p>
                    {matchingTool ? (
                      <div className="space-y-1">
                        <div>
                          <span className="text-muted-foreground">Tool result: </span>
                          <span
                            className={
                              matchingTool.status === "completed"
                                ? "text-primary font-medium"
                                : matchingTool.status === "failed"
                                  ? "text-destructive font-medium"
                                  : "font-medium"
                            }
                          >
                            {matchingTool.status === "completed"
                              ? "Tool completed (succeeded)"
                              : matchingTool.status === "failed"
                                ? `Tool failed${matchingTool.safe_error_code ? ` (${matchingTool.safe_error_code})` : ""}`
                                : matchingTool.status === "running"
                                  ? "Tool running"
                                  : `Tool ${matchingTool.status}`}
                          </span>
                        </div>
                        <p className="text-muted-foreground text-[11px]">
                          duration:{" "}
                          {toolDurationText(
                            matchingTool.started_at_ms,
                            matchingTool.completed_at_ms,
                            matchingTool.status
                          )}
                          {matchingTool.policy_outcome
                            ? ` · policy: ${matchingTool.policy_outcome}`
                            : ""}
                        </p>
                        {matchingTool.safe_error_code && (
                          <p className="text-destructive font-mono text-[11px]">
                            Safe error: {matchingTool.safe_error_code}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div>
                        <span className="text-muted-foreground">Tool result: </span>
                        <span className="text-muted-foreground font-medium">
                          {hasMoreTools
                            ? "Unavailable (tool call not in loaded snapshot)"
                            : "Unavailable (no matching tool call recorded in run snapshot)"}
                        </span>
                        <p className="text-muted-foreground text-[11px]">
                          {hasMoreTools
                            ? `Tool call with ID ${approval.tool_call_id} was not in loaded snapshot page; additional tool history remains on server.`
                            : `No G2 tool execution snapshot was recorded with call ID ${approval.tool_call_id}.`}
                        </p>
                      </div>
                    )}

                    {/* Explicitly Unknown Effect */}
                    <div className="pt-2 border-t border-border/30">
                      <span className="text-muted-foreground">Observed effect: </span>
                      <span className="font-medium">Explicitly unknown</span>
                      <p className="text-muted-foreground text-[11px]">
                        Runtime policy does not infer or verify arbitrary shell or tool side-effects from execution or permit state.
                      </p>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
