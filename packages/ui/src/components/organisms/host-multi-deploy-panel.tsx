import * as React from "react";
import { useState } from "react";
import type { HostModelRecommendation, HostOperationRequest, HostView } from "@eigen-air-ui/shared/types";
import { Badge } from "../atoms/Badge.js";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";
import { AlertCircle, CheckCircle2, Play, Users, X } from "lucide-react";

export interface DeployOutcome {
  hostId: string;
  status: "dispatched" | "ineligible" | "failed";
  operationId?: string;
  message?: string;
}

export interface HostMultiDeployPanelProps {
  artifactId: string;
  hosts: Record<string, HostView>;
  hostModels?: Record<string, HostModelRecommendation[]>;
  onFetchHostModels?: (hostId: string) => Promise<HostModelRecommendation[]>;
  onDispatch: (hostId: string, artifactId: string, req: HostOperationRequest) => Promise<string>;
  onClose: () => void;
}

export function HostMultiDeployPanel({
  artifactId,
  hosts,
  hostModels,
  onFetchHostModels,
  onDispatch,
  onClose,
}: HostMultiDeployPanelProps) {
  const hostList = Object.values(hosts);
  const [selectedHostIds, setSelectedHostIds] = useState<string[]>([]);
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [outcomes, setOutcomes] = useState<DeployOutcome[]>([]);

  const toggleHost = (id: string) => {
    setSelectedHostIds((prev) => prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id]);
  };
  const selectAll = () => {
    setSelectedHostIds(hostList.filter((h) => h.is_connected).map((h) => h.host_id));
  };

  const handleDeploy = async () => {
    if (selectedHostIds.length === 0) return;
    setIsDeploying(true);
    setOutcomes([]);

    const results = await Promise.allSettled(
      selectedHostIds.map(async (hId) => {
        const host = hosts[hId];
        if (!host || !host.is_connected) {
          return { hostId: hId, status: "ineligible" as const, message: "Host offline or disconnected" };
        }
        let recs: HostModelRecommendation[] | undefined;
        if (onFetchHostModels) {
          try {
            const fresh = await onFetchHostModels(hId);
            recs = fresh !== undefined ? fresh : hostModels?.[hId];
          } catch {
            return {
              hostId: hId,
              status: "ineligible" as const,
              message: "Failed to refresh recommendations for host; cannot authorize dispatch from stale cache",
            };
          }
        } else {
          recs = hostModels?.[hId];
        }
        if (!recs || recs.length === 0) {
          return {
            hostId: hId,
            status: "ineligible" as const,
            message: "Recommendations not loaded or artifact not evaluated on host",
          };
        }
        const rec = recs.find((r) => r.artifact_id === artifactId);
        if (!rec) {
          return {
            hostId: hId,
            status: "ineligible" as const,
            message: "Recommendations not loaded or artifact not evaluated on host",
          };
        }
        if (!rec.selectable || !rec.suggested_profile?.profile) {
          return {
            hostId: hId,
            status: "ineligible" as const,
            message: rec.disabled_reason || "Model does not fit or lacks concrete profile on host",
          };
        }
        const opReq: HostOperationRequest = {
          kind: "load",
          profile: rec.suggested_profile.profile,
        };
        const opId = await onDispatch(hId, artifactId, opReq);
        return { hostId: hId, status: "dispatched" as const, operationId: opId, message: "Operation dispatched" };
      })
    );
    const mapped: DeployOutcome[] = results.map((res, index) => {
      const hId = selectedHostIds[index];
      if (res.status === "fulfilled") return res.value;
      return { hostId: hId, status: "failed", message: res.reason instanceof Error ? res.reason.message : "Deployment failed" };
    });
    setOutcomes(mapped);
    setIsDeploying(false);
  };

  return (
    <div
      role="region"
      aria-label="Multi-host model deployment"
      className="flex flex-col gap-3 rounded-lg border border-primary/50 bg-card p-4 text-xs text-card-foreground shadow-lg"
      data-testid="multi-deploy-panel"
    >
      <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h4 className="font-semibold text-foreground text-sm">
            Deploy <span className="font-mono text-primary">{artifactId}</span> to Multiple Hosts
          </h4>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label="Close deploy panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="text-muted-foreground">
        Select target connected daemon hosts. Each deployment dispatches an independent point-to-point operation.
      </p>

      {/* Target Host Checkboxes */}
      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={selectAll}
            className="text-[11px] text-primary hover:underline"
          >
            Select All Connected
          </button>
        </div>
        {hostList.map((h) => {
          const rec = hostModels?.[h.host_id]?.find((r) => r.artifact_id === artifactId);
          return (
            <label
              key={h.host_id}
              className={`flex items-center justify-between p-2 rounded border cursor-pointer min-h-[44px] transition-colors ${
                selectedHostIds.includes(h.host_id)
                  ? "border-primary/60 bg-primary/10"
                  : "border-border/60 bg-background/50 hover:bg-background/80"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={selectedHostIds.includes(h.host_id)}
                  onChange={() => toggleHost(h.host_id)}
                  disabled={isDeploying}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
                  data-testid={`checkbox-host-${h.host_id}`}
                />
                <span className="font-medium text-foreground">{h.label || h.host_id}</span>
                <span className="text-[10px] text-muted-foreground font-mono">{h.platform}</span>
                {rec && !rec.selectable && (
                  <span className="text-[10px] text-destructive font-sans">
                    ({rec.disabled_reason || "Ineligible"})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {rec && (
                  <Badge variant={rec.selectable ? "success" : "outline"} className="text-[10px]">
                    {rec.selectable ? "Fits & Qualified" : "Ineligible"}
                  </Badge>
                )}
                <Badge variant={h.is_connected ? "success" : "outline"} className="text-[10px]">
                  {h.is_connected ? "Online" : "Offline"}
                </Badge>
              </div>
            </label>
          );
        })}
      </div>

      {/* Deploy Button */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isDeploying}
          onClick={onClose}
          className="min-h-[44px] px-3"
        >
          Close
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          disabled={selectedHostIds.length === 0 || isDeploying}
          onClick={() => void handleDeploy()}
          className="min-h-[44px] px-4 font-semibold"
          data-testid="execute-multi-deploy-btn"
        >
          {isDeploying ? <Spinner size="sm" className="mr-1.5" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
          Deploy to {selectedHostIds.length} Host{selectedHostIds.length === 1 ? "" : "s"}
        </Button>
      </div>

      {/* Deployment Outcomes */}
      {outcomes.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-border/50" data-testid="multi-deploy-outcomes">
          <span className="font-semibold text-foreground text-[11px]">Independent Deployment Outcomes:</span>
          <div className="grid gap-1.5">
            {outcomes.map((out) => (
              <div
                key={out.hostId}
                className="flex items-center justify-between p-2 rounded bg-background/70 border border-border/60 text-[11px]"
                data-testid={`outcome-${out.hostId}`}
              >
                <div className="flex items-center gap-2">
                  {out.status === "dispatched" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                  )}
                  <span className="font-medium text-foreground">{out.hostId}:</span>
                  <span className="text-muted-foreground">{out.message}</span>
                </div>
                {out.operationId && (
                  <span className="font-mono text-[10px] text-primary truncate max-w-[140px]">
                    Op: {out.operationId}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
