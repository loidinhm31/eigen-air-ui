import * as React from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Minus,
  Circle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "../atoms/Button.js";
import { Card, CardContent } from "../atoms/Card.js";
import { cn } from "@nonclaw-ui/shared/utils";
import type { ReadinessPhase } from "../../stores/readinessStore.js";
import type {
  ProviderReadinessSnapshot,
  ReadinessStageInfo,
  ReadinessStageStatus,
} from "@nonclaw-ui/shared/types";

export interface ModelReadinessBannerProps {
  phase: ReadinessPhase;
  snapshot: ProviderReadinessSnapshot | null;
  error: string | null;
  onRetry?: () => void;
}

const STAGE_LABELS: Record<string, string> = {
  config_validation: "Validating configuration",
  full_model_hash: "Verifying model file",
  backend_init: "Initializing backend",
  device_selection: "Selecting device",
  cache_initialization: "Reusable session cache",
  model_load: "Loading model weights",
  context_creation: "Creating inference context",
};

function formatStageLabel(name: string): string {
  return STAGE_LABELS[name] ?? name.replace(/_/g, " ");
}

function formatElapsed(elapsedMs?: number): string | null {
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return null;
  }
  if (elapsedMs < 1000) {
    return `${elapsedMs} ms`;
  }
  return `${(elapsedMs / 1000).toFixed(1)} s`;
}

function renderStageIcon(status: ReadinessStageStatus) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" aria-label="Completed" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 text-warning animate-spin shrink-0" aria-label="Running" />;
    case "skipped":
      return <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-label="Skipped" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" aria-label="Failed" />;
    case "pending":
    default:
      return <Circle className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" aria-label="Pending" />;
  }
}

export function ModelReadinessBanner({
  phase,
  snapshot,
  error,
  onRetry,
}: ModelReadinessBannerProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [hasCopied, setHasCopied] = React.useState(false);

  if (phase === "idle" || phase === "ready" || phase === "degraded_cpu") {
    return null;
  }

  if (phase === "checking") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        <span>Checking model readiness...</span>
      </div>
    );
  }

  if (phase === "failed") {
    const failedStage = snapshot?.details?.stages?.find((s) => s.status === "failed");
    const failureMessage =
      failedStage?.reason ?? error ?? "Model initialization failed.";

    const handleCopyDetails = () => {
      const detailsProjection = {
        status: snapshot?.status ?? "failed",
        retryable: snapshot?.retryable ?? false,
        failed_stage: failedStage?.name,
        stages: snapshot?.details?.stages?.map((s) => ({
          name: s.name,
          status: s.status,
          elapsed_ms: s.elapsed_ms,
          reason: s.reason,
        })),
      };

      void navigator.clipboard?.writeText(JSON.stringify(detailsProjection, null, 2)).then(() => {
        setHasCopied(true);
        setTimeout(() => setHasCopied(false), 2000);
      });
    };

    return (
      <Card className="border-destructive/40 bg-destructive/5 text-destructive">
        <CardContent className="flex flex-col gap-2 p-3 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 font-medium">
              <XCircle className="h-4 w-4 shrink-0 text-destructive" />
              <span>Model unavailable</span>
            </div>
            <div className="flex items-center gap-1.5">
              {onRetry && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRetry}
                  className="h-6 gap-1 text-[11px] text-foreground"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopyDetails}
                className="h-6 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {hasCopied ? (
                  <>
                    <Check className="h-3 w-3 text-success" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy details
                  </>
                )}
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground">{failureMessage}</p>
        </CardContent>
      </Card>
    );
  }

  // phase === "starting"
  const stages = snapshot?.details?.stages ?? [];
  const currentRunning = stages.find((s) => s.status === "running");
  const currentSummary = currentRunning
    ? formatStageLabel(currentRunning.name)
    : "Preparing model...";

  return (
    <div className="flex flex-col rounded-md border border-border/60 bg-card p-2.5 text-xs shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-warning shrink-0" />
          <div className="flex items-center gap-1.5 truncate">
            <span className="font-medium text-foreground">Loading model:</span>
            <span className="text-muted-foreground truncate">{currentSummary}</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
          aria-expanded={isExpanded}
        >
          <span>{isExpanded ? "Hide details" : "Details"}</span>
          {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>
      </div>

      {isExpanded && stages.length > 0 && (
        <div className="mt-2.5 space-y-1.5 border-t border-border/40 pt-2">
          {stages.map((stage: ReadinessStageInfo) => {
            const elapsed = formatElapsed(stage.elapsed_ms);
            return (
              <div
                key={stage.name}
                className="flex items-center justify-between gap-2 text-[11px]"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {renderStageIcon(stage.status)}
                  <span
                    className={cn(
                      stage.status === "running"
                        ? "font-medium text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {formatStageLabel(stage.name)}
                  </span>
                  {stage.reason && (
                    <span className="text-[10px] text-muted-foreground/70 italic truncate">
                      ({stage.reason})
                    </span>
                  )}
                </div>
                {elapsed && (
                  <span className="font-mono text-[10px] text-muted-foreground/70 shrink-0">
                    {elapsed}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

ModelReadinessBanner.displayName = "ModelReadinessBanner";
