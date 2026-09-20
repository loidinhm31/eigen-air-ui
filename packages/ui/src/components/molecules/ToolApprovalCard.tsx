import * as React from "react";
import type {
  ToolApprovalSnapshot,
  ToolApprovalSafeSummary,
  ToolApprovalProgramSafeSummary,
  ToolApprovalTemplateSafeSummary,
} from "@nonclaw-ui/shared/types";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";

export interface ToolApprovalCardProps {
  readonly approval: ToolApprovalSnapshot;
  readonly onAllowOnce: () => void;
  readonly onDeny: () => void;
  readonly disabled?: boolean;
  readonly submitting?: boolean;
  readonly reconciling?: boolean;
  readonly offline?: boolean;
  readonly accepted?: boolean;
  readonly error?: string | null;
  readonly status?: string | null;
}

function isProgramSummary(summary: ToolApprovalSafeSummary): summary is ToolApprovalProgramSafeSummary {
  return "program" in summary;
}

function isTemplateSummary(summary: ToolApprovalSafeSummary): summary is ToolApprovalTemplateSafeSummary {
  return "template_preview" in summary;
}
export function ToolApprovalCard({
  approval,
  onAllowOnce,
  onDeny,
  disabled = false,
  submitting = false,
  reconciling = false,
  offline = false,
  accepted = false,
  error = null,
  status = null,
}: ToolApprovalCardProps) {
  const id = React.useId().replace(/:/g, "");
  const headingId = `${id}-heading`;
  const errorId = `${id}-error`;

  const busy = submitting || reconciling;
  const controlsDisabled = disabled || busy || offline || accepted;



  const statusText =
    status ??
    (submitting
      ? "Submitting decision…"
      : reconciling
        ? "Reconciling approval state…"
        : offline
          ? "Offline. Reconnecting…"
          : accepted
            ? "Decision accepted. Resuming…"
            : null);

  return (
    <div
      role="region"
      aria-labelledby={headingId}
      className="border-border bg-card space-y-3 rounded-lg border p-4 text-card-foreground shadow-sm min-w-0 max-w-full overflow-hidden break-words"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={headingId} className="text-base font-semibold text-foreground">
          Tool approval required
        </h3>
        <span className="text-xs font-semibold uppercase text-destructive bg-destructive/10 px-2 py-0.5 rounded">
          Risk: High
        </span>
      </div>

      <div className="text-sm">
        <span className="text-muted-foreground text-xs font-medium">Operation: </span>
        <span className="font-mono text-sm font-semibold">
          {approval.tool_name}.{approval.operation}
        </span>
      </div>

      <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/40 p-3 text-sm">
        {isProgramSummary(approval.safe_summary) && (
          <>
            <div>
              <span className="text-muted-foreground text-xs font-medium">Program: </span>
              <span className="font-mono text-sm">{approval.safe_summary.program}</span>
            </div>
            <div>
              <span className="text-muted-foreground text-xs font-medium">Argument count: </span>
              <span className="text-sm">{approval.safe_summary.args_count}</span>
            </div>
            <div>
              <span className="text-muted-foreground text-xs font-medium">Working directory: </span>
              <span className="font-mono text-sm">{approval.safe_summary.working_dir}</span>
            </div>
          </>
        )}

        {isTemplateSummary(approval.safe_summary) && (
          <>
            <div>
              <span className="text-muted-foreground text-xs font-medium">Tool: </span>
              <span className="text-sm">{approval.safe_summary.tool_name}</span>
            </div>
            <div>
              <span className="text-muted-foreground text-xs font-medium">Template preview: </span>
              <span className="font-mono text-sm">{approval.safe_summary.template_preview}</span>
            </div>
            <div>
              <span className="text-muted-foreground text-xs font-medium">Parameter names: </span>
              <span className="text-sm">
                {approval.safe_summary.param_names.length > 0
                  ? approval.safe_summary.param_names.join(", ")
                  : "none"}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground text-xs font-medium">Working directory: </span>
              <span className="font-mono text-sm">{approval.safe_summary.working_dir}</span>
            </div>
          </>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        Allow Once authorizes one attempt of this exact operation. Deny rejects it.
      </p>

      {error && (
        <div id={errorId} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </div>
      )}

      {statusText && (
        <div aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground">
          {busy && <Spinner size="sm" />}
          <span>{statusText}</span>
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <Button
          type="button"
          variant="default"
          onClick={onAllowOnce}
          disabled={controlsDisabled}
          aria-label="Allow Once"
          aria-busy={submitting}
        >
          Allow Once
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={onDeny}
          disabled={controlsDisabled}
          aria-label="Deny"
          aria-busy={submitting}
        >
          Deny
        </Button>
      </div>
    </div>
  );
}
