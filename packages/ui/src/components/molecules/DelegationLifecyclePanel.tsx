import * as React from "react";
import type {
  RunTreeNodeDto,
  TaskProgressProjectionStatus,
  TaskProgressSnapshotDto,
  TaskProgressVerificationStatus,
} from "@eigen-air-ui/shared/types";
import { formatTimestamp } from "../organisms/runInspectorFormatting.js";

export const PROJECTION_STATUS_LABELS: Record<TaskProgressProjectionStatus, string> = {
  queued: "Queued",
  running: "Running",
  blocked: "Blocked",
  partial: "Partial",
  cancel_requested: "Cancel requested (not terminal)",
  cancelled: "Cancelled (terminal)",
  failed: "Failed (terminal)",
  succeeded: "Succeeded (terminal)",
};

export const VERIFICATION_STATUS_LABELS: Record<TaskProgressVerificationStatus, string> = {
  unverified: "Unverified (lifecycle only)",
  verified_success: "Verified success (lifecycle only)",
  verified_failure: "Verified failure (lifecycle only)",
};

export interface DelegationLifecyclePanelProps {
  runId: string;
  parentRunId?: string | null;
  rootRunId?: string | null;
  taskProgress?: TaskProgressSnapshotDto | null;
  runTreeNodes?: RunTreeNodeDto[] | null;
  runTreeLoading?: boolean;
  runTreeError?: string;
  onSelectRun?(runId: string): void;
}

export function DelegationLifecyclePanel({
  runId,
  parentRunId,
  rootRunId,
  taskProgress,
  runTreeNodes,
  runTreeLoading,
  runTreeError,
  onSelectRun,
}: DelegationLifecyclePanelProps) {
  const childNodes = React.useMemo(() => {
    if (!Array.isArray(runTreeNodes)) return [];
    return runTreeNodes.filter((node) => node.parent_run_id === runId);
  }, [runId, runTreeNodes]);

  return (
    <section aria-labelledby="delegation-lifecycle-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="delegation-lifecycle-heading" className="text-sm font-semibold">
          Delegation progress & lifecycle
        </h3>
        {taskProgress && (
          <span className="bg-muted text-muted-foreground rounded px-2 py-0.5 text-xs font-mono">
            rev {taskProgress.artifact_revision}
          </span>
        )}
      </div>

      {!taskProgress ? (
        <div className="rounded border border-border/60 bg-muted/20 p-3">
          <p className="text-muted-foreground text-sm">
            Task progress projection not reported / unavailable for this run.
          </p>
        </div>
      ) : (
        <div className="space-y-3 rounded border border-border p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground font-medium">Projection status:</span>
              <span
                className="bg-muted rounded px-2 py-0.5 font-mono text-xs"
                data-testid="projection-status"
              >
                {PROJECTION_STATUS_LABELS[taskProgress.projection_status] ?? taskProgress.projection_status}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground font-medium">Lifecycle verification:</span>
              <span
                className="bg-muted rounded px-2 py-0.5 font-mono text-xs"
                data-testid="verification-status"
              >
                {VERIFICATION_STATUS_LABELS[taskProgress.verification_status] ?? taskProgress.verification_status}
              </span>
            </div>
          </div>

          <div
            className="rounded border border-border/80 bg-muted/30 p-2.5 space-y-1"
            aria-label="Model-claimed counts"
          >
            <h4 className="text-muted-foreground text-xs font-semibold">
              Model-claimed counts (unverified by server)
            </h4>
            <p className="text-xs">
              Total items: <span className="font-mono font-medium">{taskProgress.claimed_item_count}</span> · Active items:{" "}
              <span className="font-mono font-medium">{taskProgress.claimed_active_count}</span>
            </p>
          </div>

          <div className="text-muted-foreground space-y-1 text-xs">
            <p className="font-mono">
              timing: updated {formatTimestamp(taskProgress.updated_at_ms)}
              {taskProgress.terminal_at_ms != null &&
                ` · terminal ${formatTimestamp(taskProgress.terminal_at_ms)}`}
            </p>
            <p className="font-mono">
              sequence: artifact event seq {taskProgress.artifact_event_seq} · G2 seq{" "}
              {taskProgress.g2_snapshot_seq}
            </p>
            <p className="break-all font-mono">
              scope: task {taskProgress.task_id} · subagent run {taskProgress.subagent_run_id} · root session{" "}
              {taskProgress.root_session_id}
            </p>
            <p className="break-all font-mono">
              artifact {taskProgress.artifact_id} · trace {taskProgress.trace_id || "Not reported"}
            </p>
          </div>

          {taskProgress.redaction.metadata_only && (
            <p className="text-muted-foreground text-xs italic">
              Metadata-only projection; item labels and evidence bodies are redacted by policy.
            </p>
          )}
        </div>
      )}

      <div className="space-y-2 rounded border border-border/60 p-3 text-xs">
        <h4 className="font-semibold text-xs">Hierarchy & navigation</h4>
        <div className="space-y-1">
          <p className="text-muted-foreground">
            Parent run:{" "}
            {parentRunId ? (
              <button
                type="button"
                onClick={() => onSelectRun?.(parentRunId)}
                className="font-mono text-primary underline hover:text-primary/80 focus-visible:outline focus-visible:outline-2"
                aria-label={`Navigate to parent run ${parentRunId}`}
              >
                {parentRunId}
              </button>
            ) : (
              <span className="font-mono">None (root run)</span>
            )}
          </p>
          {rootRunId && rootRunId !== runId && (
            <p className="text-muted-foreground">
              Root run:{" "}
              <button
                type="button"
                onClick={() => onSelectRun?.(rootRunId)}
                className="font-mono text-primary underline hover:text-primary/80 focus-visible:outline focus-visible:outline-2"
                aria-label={`Navigate to root run ${rootRunId}`}
              >
                {rootRunId}
              </button>
            </p>
          )}
        </div>

        <div className="pt-2 border-t border-border/60 space-y-1.5">
          <span className="font-medium text-muted-foreground">Authorized child runs:</span>
          {runTreeLoading && (
            <p className="text-muted-foreground">Loading delegation hierarchy…</p>
          )}
          {runTreeError && (
            <p className="text-destructive">Delegation hierarchy unavailable: {runTreeError}</p>
          )}
          {!runTreeLoading && !runTreeError && !Array.isArray(runTreeNodes) && (
            <p className="text-muted-foreground">
              Delegation hierarchy unavailable or authorization-filtered.
            </p>
          )}
          {!runTreeLoading && !runTreeError && Array.isArray(runTreeNodes) && childNodes.length === 0 && (
            <p className="text-muted-foreground">
              No known child runs in authorized run tree. (List may be authorization-filtered; missing mapping is not proof of no children.)
            </p>
          )}
          {!runTreeLoading && !runTreeError && Array.isArray(runTreeNodes) && childNodes.length > 0 && (
            <ul className="space-y-1" aria-label="Child runs">
              {childNodes.map((node) => (
                <li
                  key={node.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded bg-muted/40 px-2 py-1.5 font-mono"
                >
                  <div className="flex items-center gap-2">
                    {node.child_run_id ? (
                      <button
                        type="button"
                        onClick={() => onSelectRun?.(node.child_run_id!)}
                        className="text-primary underline hover:text-primary/80 focus-visible:outline focus-visible:outline-2"
                        aria-label={`Navigate to child run ${node.child_run_id}`}
                      >
                        run: {node.child_run_id}
                      </button>
                    ) : (
                      <span>session: {node.child_session_id}</span>
                    )}
                    <span className="text-muted-foreground">task: {node.delegated_task_id}</span>
                  </div>
                  <div className="text-muted-foreground">
                    agent: {node.target_agent_id} · depth: {node.depth}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
