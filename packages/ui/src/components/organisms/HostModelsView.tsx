import * as React from "react";
import { useEffect, useState } from "react";
import { useInferenceStore } from "../../stores/inferenceStore.js";
import { HostModelRecommendationCard } from "./host-model-recommendation-card.js";
import { HostOperationProgressCard } from "./host-operation-progress-card.js";
import { HostMultiDeployPanel } from "./host-multi-deploy-panel.js";
import { HostModelsHeader } from "./host-models-header.js";
import { AlertCircle } from "lucide-react";

export interface HostModelsViewProps {
  hostId?: string;
  onHostChange?: (hostId: string) => void;
  className?: string;
}

export function HostModelsView({ hostId: propHostId, onHostChange, className = "" }: HostModelsViewProps) {
  const {
    hosts,
    hostModels,
    hostOperations,
    fetchHosts,
    fetchHostModels,
    fetchHostOperations,
    dispatchModelOperation,
    cancelOperation,
  } = useInferenceStore();

  const hostList = Object.values(hosts);
  const defaultHostId = propHostId || (hostList.length > 0 ? hostList[0].host_id : "");
  const [selectedHostId, setSelectedHostId] = useState<string>(defaultHostId);
  const [multiDeployArtifactId, setMultiDeployArtifactId] = useState<string | null>(null);
  const [busyArtifactId, setBusyArtifactId] = useState<string | null>(null);
  const [cancellingOpId, setCancellingOpId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const effectiveHostId = propHostId || selectedHostId;

  useEffect(() => {
    void fetchHosts();
  }, [fetchHosts]);

  useEffect(() => {
    if (propHostId) setSelectedHostId(propHostId);
    else if (!selectedHostId && hostList.length > 0) setSelectedHostId(hostList[0].host_id);
  }, [propHostId, hostList, selectedHostId]);

  useEffect(() => {
    if (!effectiveHostId) return;
    setLoading(true);
    void Promise.allSettled([
      fetchHostModels(effectiveHostId),
      fetchHostOperations(effectiveHostId),
    ]).finally(() => setLoading(false));
  }, [effectiveHostId, fetchHostModels, fetchHostOperations]);

  const recommendations = (effectiveHostId && hostModels[effectiveHostId]) || [];
  const operations = (effectiveHostId && hostOperations[effectiveHostId]) || [];
  const activeOperations = operations.filter(
    (op) => op.state === "running" || op.state === "queued" || op.state === "cancelling"
  );

  const validRanks = recommendations.map((r) => r.rank).filter((r): r is number => typeof r === "number" && r > 0);
  const minRank = validRanks.length > 0 ? Math.min(...validRanks) : null;

  const handleHostChange = (newHostId: string) => {
    setSelectedHostId(newHostId);
    setActionError(null);
    onHostChange?.(newHostId);
  };

  const handleLoad = async (artifactId: string) => {
    if (!effectiveHostId) return;
    setBusyArtifactId(artifactId);
    setActionError(null);
    try {
      const rec = recommendations.find((r) => r.artifact_id === artifactId);
      await dispatchModelOperation(effectiveHostId, artifactId, {
        kind: "load",
        profile: rec?.suggested_profile?.profile,
      });
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to dispatch load operation");
    } finally {
      setBusyArtifactId(null);
    }
  };

  const handleCancel = async (operationId: string) => {
    setCancellingOpId(operationId);
    setActionError(null);
    try {
      await cancelOperation(operationId);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to cancel operation");
    } finally {
      setCancellingOpId(null);
    }
  };

  return (
    <div className={`space-y-6 ${className}`} data-testid="host-models-view">
      <HostModelsHeader
        effectiveHostId={effectiveHostId}
        hostList={hostList}
        loading={loading}
        onHostChange={handleHostChange}
        onRefresh={() => {
          if (effectiveHostId) {
            void fetchHostModels(effectiveHostId);
            void fetchHostOperations(effectiveHostId);
          }
        }}
      />

      {actionError && (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/15 p-2.5 text-xs text-destructive"
          data-testid="host-models-error"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-xs hover:underline ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Active Operations Progress Region */}
      {activeOperations.length > 0 && (
        <div className="space-y-2.5" data-testid="active-operations-region">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Active Host Operations ({activeOperations.length})
          </h3>
          <div className="grid gap-2">
            {activeOperations.map((op) => (
              <HostOperationProgressCard
                key={op.operation_id}
                operation={op}
                onCancel={handleCancel}
                isCancelling={cancellingOpId === op.operation_id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Multi-Deploy Panel */}
      {multiDeployArtifactId && (
        <HostMultiDeployPanel
          key={multiDeployArtifactId}
          artifactId={multiDeployArtifactId}
          hosts={hosts}
          hostModels={hostModels}
          onFetchHostModels={fetchHostModels}
          onDispatch={dispatchModelOperation}
          onClose={() => setMultiDeployArtifactId(null)}
        />
      )}

      {/* Catalog Recommendations List */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Recommended Models ({recommendations.length})
        </h3>

        {recommendations.length === 0 && !loading ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
            {effectiveHostId
              ? "No catalog recommendations evaluated for this host."
              : "Select a host to view catalog recommendations."}
          </div>
        ) : (
          <div className="grid gap-3">
            {recommendations.map((rec) => {
              const isTop = rec.rank === 1 || (minRank !== null && rec.rank === minRank);

              return (
                <HostModelRecommendationCard
                  key={rec.artifact_id}
                  recommendation={rec}
                  isTopRanked={isTop}
                  isLoading={busyArtifactId === rec.artifact_id}
                  onLoad={handleLoad}
                  onOpenMultiDeploy={(artId) => setMultiDeployArtifactId(artId)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
