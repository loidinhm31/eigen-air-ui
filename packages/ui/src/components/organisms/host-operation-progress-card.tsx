import * as React from "react";
import { useEffect, useState } from "react";
import type { OperationSnapshot } from "@eigen-air-ui/shared/types";
import { Badge } from "../atoms/Badge.js";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";
import { Activity, Clock, X, XCircle } from "lucide-react";

export interface HostOperationProgressCardProps {
  operation: OperationSnapshot;
  onCancel?: (operationId: string) => Promise<void>;
  onDismiss?: (operationId: string) => void;
  isCancelling?: boolean;
}

function formatUnits(val?: number, unit?: string): string {
  if (val === undefined || val === null || !Number.isFinite(val)) return "—";
  if (unit === "bytes") {
    if (val < 1024 * 1024) return `${(val / 1024).toFixed(1)} KB`;
    if (val < 1024 * 1024 * 1024) return `${(val / (1024 * 1024)).toFixed(1)} MB`;
    return `${(val / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (unit === "tokens") return `${val.toLocaleString()} tokens`;
  return `${val.toLocaleString()} ${unit || "units"}`;
}

export function HostOperationProgressCard({
  operation,
  onCancel,
  onDismiss,
  isCancelling = false,
}: HostOperationProgressCardProps) {
  const {
    operation_id,
    artifact_id,
    kind,
    state,
    stage,
    counters,
    started_at_ms,
    updated_at_ms,
    completed_at_ms,
    error_message,
  } = operation;

  const isActive = state === "running" || state === "queued" || state === "cancelling";
  const [currentNow, setCurrentNow] = useState<number>(Date.now());

  // Live timer tick for active operations
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => setCurrentNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isActive]);

  const startTime = started_at_ms ?? updated_at_ms ?? currentNow;
  const endTime = isActive ? currentNow : (completed_at_ms ?? updated_at_ms ?? currentNow);
  const elapsedSec = Math.max(0, Math.round((endTime - startTime) / 1000));

  const hasUnits =
    counters.completed_units !== undefined &&
    counters.total_units !== undefined &&
    counters.total_units > 0;
  const percent = hasUnits
    ? Math.min(100, Math.round(((counters.completed_units ?? 0) / (counters.total_units ?? 1)) * 100))
    : null;

  return (
    <div
      className="flex flex-col gap-2.5 rounded-lg border border-border/80 bg-card p-3 text-xs text-card-foreground shadow-sm"
      data-testid={`operation-progress-${operation_id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className={`h-4 w-4 text-primary ${isActive ? "animate-pulse" : ""}`} />
          <span className="font-semibold text-foreground truncate">{artifact_id}</span>
          <Badge variant="outline" className="text-[10px] uppercase font-mono">
            {kind}
          </Badge>
          {stage && stage.toLowerCase() !== state.toLowerCase() && (
            <Badge variant="outline" className="text-[10px] uppercase text-muted-foreground">
              {stage.replace("_", " ")}
            </Badge>
          )}
          <Badge
            variant={state === "completed" ? "success" : state === "failed" ? "destructive" : "warning"}
            className="text-[10px]"
            data-testid={`operation-state-${operation_id}`}
          >
            {state}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {elapsedSec}s elapsed
          </span>
          {isActive && onCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isCancelling || state === "cancelling"}
              onClick={() => void onCancel(operation_id)}
              className="min-h-[44px] px-3 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
              data-testid={`cancel-operation-${operation_id}`}
            >
              {isCancelling ? <Spinner size="sm" className="mr-1" /> : <XCircle className="mr-1 h-3.5 w-3.5" />}
              {state === "cancelling" ? "Cancelling..." : "Cancel"}
            </Button>
          )}
          {!isActive && onDismiss && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onDismiss(operation_id)}
              className="min-h-[44px] px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50"
              data-testid={`dismiss-operation-${operation_id}`}
              aria-label={`Dismiss operation ${operation_id}`}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Dismiss
            </Button>
          )}
        </div>
      </div>

      {percent !== null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full transition-all duration-300 ${
              state === "failed" ? "bg-destructive" : state === "completed" ? "bg-emerald-500" : "bg-primary"
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      <div className="flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {hasUnits
            ? `${formatUnits(counters.completed_units, counters.unit)} / ${formatUnits(counters.total_units, counters.unit)} (${percent}%)`
            : counters.completed_units !== undefined
              ? `${formatUnits(counters.completed_units, counters.unit)} completed`
              : isActive
                ? state === "queued"
                  ? "Queued"
                  : state === "cancelling"
                    ? "Cancelling..."
                    : "In progress"
                : state === "completed"
                  ? "Completed"
                  : state === "failed"
                    ? "Failed"
                    : state === "cancelled"
                      ? "Cancelled"
                      : state === "indeterminate"
                        ? "Outcome unknown"
                        : state}
        </span>
        <div className="flex items-center gap-3">
          {isActive && counters.tokens_per_second !== undefined && (
            <span className="font-medium text-emerald-400">
              {counters.tokens_per_second.toFixed(1)} tok/s
            </span>
          )}
          {isActive && counters.estimated_remaining_seconds !== undefined && (
            <span>ETA: {Math.round(counters.estimated_remaining_seconds)}s</span>
          )}
        </div>
      </div>

      {error_message && (
        <p className="text-destructive text-[11px]" role="alert">
          {error_message}
        </p>
      )}
    </div>
  );
}
