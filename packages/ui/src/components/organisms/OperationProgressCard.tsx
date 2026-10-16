import * as React from "react";
import type { CanonicalOperationSnapshot } from "@eigen-air-ui/shared/types";
import { Badge } from "../atoms/Badge.js";
import { Button } from "../atoms/Button.js";

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface OperationProgressCardProps {
  snapshot: CanonicalOperationSnapshot;
  onCancel?: (operationId: string) => void;
}

export function OperationProgressCard({ snapshot, onCancel }: OperationProgressCardProps) {
  const { operation_id, artifact_id, stage, status, counters, error_code, error_message } = snapshot;

  const isDownload = stage === "download";
  const hasUnits = counters.completed_units !== undefined && counters.total_units !== undefined && counters.total_units > 0;
  const percent = hasUnits ? Math.min(100, Math.round(((counters.completed_units ?? 0) / (counters.total_units ?? 1)) * 100)) : null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/70 bg-card p-3 text-xs text-card-foreground">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <span className="truncate">{artifact_id}</span>
          <Badge variant="outline" className="text-[10px] uppercase">
            {stage.replace("_", " ")}
          </Badge>
          <Badge
            variant={status === "completed" ? "success" : status === "failed" ? "destructive" : "outline"}
            className="text-[10px]"
          >
            {status}
          </Badge>
        </div>
        {status === "active" && onCancel && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px] text-destructive hover:bg-destructive/10"
            onClick={() => onCancel(operation_id)}
          >
            Cancel
          </Button>
        )}
      </div>

      {isDownload && (
        <div className="space-y-1">
          {percent !== null && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
          <div className="flex flex-wrap justify-between gap-2 text-muted-foreground">
            <span>
              {formatBytes(counters.completed_units)} / {formatBytes(counters.total_units)}
              {percent !== null && ` (${percent}%)`}
            </span>
            {counters.bytes_per_second !== undefined && (
              <span>{(counters.bytes_per_second / (1024 * 1024)).toFixed(1)} MB/s</span>
            )}
            {counters.estimated_remaining_seconds !== undefined && (
              <span>ETA: {Math.round(counters.estimated_remaining_seconds)}s</span>
            )}
          </div>
        </div>
      )}

      {stage === "verify" && (
        <p className="text-muted-foreground">Verifying artifact SHA-256 integrity...</p>
      )}

      {stage === "load_context" && (
        <p className="text-muted-foreground">Loading transformer model context into memory...</p>
      )}

      {(stage === "prepare_kv" || stage === "save_kv") && (
        <div className="flex gap-4 text-muted-foreground">
          {counters.evaluated_prompt_tokens !== undefined && (
            <span>Evaluated: {counters.evaluated_prompt_tokens} tokens</span>
          )}
          {counters.reused_prompt_tokens !== undefined && (
            <span>Reused: {counters.reused_prompt_tokens} tokens</span>
          )}
        </div>
      )}

      {error_code && (
        <p className="font-medium text-destructive">
          Error [{error_code}]: {error_message ?? "Operation failed"}
        </p>
      )}
    </div>
  );
}
