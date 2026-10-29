import * as React from "react";
import type { FitVerdict, HostModelRecommendation, TupleQualificationStatus } from "@eigen-air-ui/shared/types";
import { Badge } from "../atoms/Badge.js";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";
import { AlertTriangle, Cpu, Gauge, Play, ShieldAlert, Sparkles, Users } from "lucide-react";

export interface HostModelRecommendationCardProps {
  recommendation: HostModelRecommendation;
  isTopRanked?: boolean;
  isLoading?: boolean;
  onLoad: (artifactId: string) => Promise<void>;
  onOpenMultiDeploy?: (artifactId: string) => void;
}

const FIT_CONFIG: Record<string, { variant: "success" | "warning" | "destructive" | "outline"; label: string }> = {
  fits: { variant: "success", label: "Fits" },
  fits_gpu: { variant: "success", label: "Fits GPU" },
  fits_with_warning: { variant: "warning", label: "Fits with Warning" },
  fits_partial_offload: { variant: "warning", label: "Partial Offload" },
  cpu_only: { variant: "outline", label: "CPU Only" },
  does_not_fit: { variant: "destructive", label: "Does Not Fit" },
  unknown: { variant: "outline", label: "Unknown Fit" },
};

const QUAL_CONFIG: Record<TupleQualificationStatus, { variant: "success" | "warning" | "destructive" | "outline"; label: string }> = {
  qualified: { variant: "success", label: "Qualified" },
  unqualified: { variant: "outline", label: "Unqualified" },
  blocked: { variant: "destructive", label: "Blocked" },
  degraded: { variant: "warning", label: "Degraded" },
  unknown: { variant: "outline", label: "Unknown" },
};

export function HostModelRecommendationCard({
  recommendation,
  isTopRanked = false,
  isLoading = false,
  onLoad,
  onOpenMultiDeploy,
}: HostModelRecommendationCardProps) {
  const { artifact_id, fit, suggested_profile, qualification, perf, risks, selectable, disabled_reason, rank } =
    recommendation;

  const fitKey = typeof fit === "object" ? fit.verdict : fit;
  const fitLabel = typeof fit === "object" ? (fit.reason || FIT_CONFIG[fitKey]?.label || fitKey) : (FIT_CONFIG[fitKey]?.label || fitKey);
  const fitMeta = FIT_CONFIG[fitKey] ?? { variant: "outline" as const, label: String(fitLabel) };
  const qualMeta = QUAL_CONFIG[qualification] ?? { variant: "outline" as const, label: qualification };

  const prefillTps = perf.prefill_tps ?? perf.prefill_tokens_per_second;
  const decodeTps = perf.decode_tps ?? perf.decode_tokens_per_second;
  const sourceLabel = typeof perf.source === "string"
    ? perf.source.replace(/_/g, " ")
    : perf.source && typeof perf.source === "object"
    ? perf.source.type === "receipt_exact_tuple"
      ? `receipt: ${perf.source.receipt_id.slice(0, 8)}`
      : perf.source.type === "observed_turns"
      ? `observed: ${perf.source.n} turns`
      : perf.source.type
    : "not measured";
  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border p-4 text-xs transition-colors ${
        isTopRanked
          ? "border-primary/80 bg-primary/5 shadow-md shadow-primary/5"
          : "border-border bg-card shadow-sm hover:border-border/90"
      }`}
      data-testid={`recommendation-card-${artifact_id}`}
    >
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-sm text-foreground">{artifact_id}</span>
          {isTopRanked && (
            <Badge variant="primary" className="flex items-center gap-1 text-[10px]" data-testid="top-ranked-badge">
              <Sparkles className="h-3 w-3" />
              <span>Top Recommended{rank !== null ? ` (#${rank})` : ""}</span>
            </Badge>
          )}
          <Badge variant={fitMeta.variant} className="text-[10px]" data-testid={`fit-badge-${artifact_id}`}>
            {fitMeta.label}
          </Badge>
          <Badge variant={qualMeta.variant} className="text-[10px]" data-testid={`qual-badge-${artifact_id}`}>
            {qualMeta.label}
          </Badge>
        </div>

        {/* Load & Multi-Deploy Actions */}
        <div className="flex items-center gap-2">
          {onOpenMultiDeploy && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenMultiDeploy(artifact_id)}
              className="min-h-[44px] px-3 text-xs"
              data-testid={`multi-deploy-btn-${artifact_id}`}
            >
              <Users className="mr-1.5 h-3.5 w-3.5" />
              Multi-Deploy
            </Button>
          )}
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={!selectable || isLoading}
            onClick={() => void onLoad(artifact_id)}
            className="min-h-[44px] px-4 font-semibold"
            data-testid={`load-btn-${artifact_id}`}
          >
            {isLoading ? <Spinner size="sm" className="mr-1.5" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
            Load Model
          </Button>
        </div>
      </div>

      {/* Suggested Profile */}
      {suggested_profile && (
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground pt-0.5">
          <span className="font-medium text-foreground flex items-center gap-1">
            <Cpu className="h-3.5 w-3.5 text-primary" /> Profile:
          </span>
          <Badge variant="outline" className="text-[10px]">{suggested_profile.context_tokens} ctx</Badge>
          <Badge variant="outline" className="text-[10px]">{suggested_profile.backend}</Badge>
          {suggested_profile.device_label && (
            <Badge variant="outline" className="text-[10px]">{suggested_profile.device_label}</Badge>
          )}
          <Badge variant="outline" className="text-[10px]">{suggested_profile.gpu_layers} layers</Badge>
          <Badge variant="outline" className="text-[10px]">{suggested_profile.kv_placement}</Badge>
          <Badge variant="outline" className="text-[10px]">
            {suggested_profile.flash_attention ? "Flash Attn" : "Standard Attn"}
          </Badge>
        </div>
      )}

      {/* Measured Performance & Provenance */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground border-t border-border/40 pt-2">
        <span className="flex items-center gap-1 font-medium text-foreground">
          <Gauge className="h-3.5 w-3.5 text-emerald-400" /> Measured Tok/s:
        </span>
        <span>
          Prefill: {prefillTps !== null && prefillTps !== undefined
            ? `${prefillTps.toFixed(1)} tok/s`
            : "—"}
        </span>
        <span>
          Decode: {decodeTps !== null && decodeTps !== undefined
            ? `${decodeTps.toFixed(1)} tok/s`
            : "—"}
        </span>
        <Badge variant="outline" className="text-[10px] font-mono">
          src: {sourceLabel}
        </Badge>
      </div>

      {/* Risk Chips & Disabled Reason */}
      {(risks.length > 0 || (!selectable && disabled_reason)) && (
        <div className="flex flex-col gap-1.5 pt-1">
          {risks.map((risk, idx) => (
            <div
              key={`${risk.code}-${idx}`}
              className={`flex items-start gap-1.5 rounded p-1.5 text-[11px] ${
                risk.severity === "critical"
                  ? "bg-destructive/15 text-destructive border border-destructive/40"
                  : risk.severity === "warning"
                    ? "bg-amber-500/15 text-amber-400 border border-amber-500/40"
                    : "bg-muted/40 text-muted-foreground border border-border/60"
              }`}
              data-testid={`risk-chip-${risk.code}`}
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                <strong>{risk.code}:</strong> {risk.message}
              </span>
            </div>
          ))}

          {!selectable && disabled_reason && (
            <div
              className="flex items-center gap-1.5 text-[11px] text-destructive bg-destructive/10 border border-destructive/30 rounded p-1.5"
              data-testid={`disabled-reason-${artifact_id}`}
            >
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              <span>{disabled_reason}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
