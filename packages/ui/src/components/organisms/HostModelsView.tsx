import * as React from "react";
import { useEffect, useRef, useState } from "react";
import type { AppSourceRef, OperationState } from "@eigen-air-ui/shared/types";
import { resolveAuthoritativeModelDigest } from "@eigen-air-ui/shared/types";
import { useInferenceStore } from "../../stores/inferenceStore.js";
import { HostModelRecommendationCard } from "./host-model-recommendation-card.js";
import { HostOperationProgressCard } from "./host-operation-progress-card.js";
import { HostMultiDeployPanel } from "./host-multi-deploy-panel.js";
import { HostModelsHeader } from "./host-models-header.js";
import { HostCachePurgeControl } from "./host-cache-purge-control.js";
import { Button } from "../atoms/Button.js";
import { Badge } from "../atoms/Badge.js";
import { Spinner } from "../atoms/Spinner.js";
import { AlertCircle, Check, Download, RotateCcw, Square, Zap } from "lucide-react";

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
    operations: allOperations,
    fetchHosts,
    fetchHostModels,
    fetchHostOperations,
    dispatchModelOperation,
    cancelOperation,
    purgeHostCache,
    persistedMutations,
    retryPendingMutation,
    dismissedOperations,
    dismissHostOperation,
    clearFinishedHostOperations,
  } = useInferenceStore();
  const hostList = Object.values(hosts);
  const defaultHostId = propHostId || (hostList.length > 0 ? hostList[0].host_id : "");
  const [selectedHostId, setSelectedHostId] = useState<string>(defaultHostId);
  const [multiDeployArtifactId, setMultiDeployArtifactId] = useState<string | null>(null);
  const [busyArtifactId, setBusyArtifactId] = useState<string | null>(null);
  const [cancellingOpId, setCancellingOpId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [licensePromptArtifact, setLicensePromptArtifact] = useState<string | null>(null);
  const [retryingMutationId, setRetryingMutationId] = useState<string | null>(null);

  const effectiveHostId = propHostId || selectedHostId;
  const effectiveHostIdRef = useRef(effectiveHostId);
  useEffect(() => {
    effectiveHostIdRef.current = effectiveHostId;
  }, [effectiveHostId]);


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
  const operationsFromStore = effectiveHostId
    ? Object.values(allOperations)
        .filter((op) => op.host_id === effectiveHostId)
        .map((c) => {
          const opState: OperationState =
            c.state ??
            (c.status === "pending"
              ? "queued"
              : c.status === "active"
              ? "running"
              : c.status === "coalesced"
              ? "completed"
              : c.status);
          return {
            operation_id: c.operation_id,
            host_id: c.host_id || effectiveHostId,
            artifact_id: c.artifact_id,
            kind: c.kind || "load",
            state: opState,
            stage: c.stage,
            revision: c.revision,
            counters: c.counters,
            started_at_ms: c.started_at_ms,
            updated_at_ms: c.updated_at_ms,
            completed_at_ms: c.completed_at_ms,
            error_code: c.error_code,
            error_message: c.error_message,
          };
        })
    : [];
  const isOperationDismissed = (opId: string, revision?: number) => {
    if (!dismissedOperations) return false;
    const dismissedRev = dismissedOperations[opId];
    if (dismissedRev === undefined) return false;
    return (revision ?? 0) <= dismissedRev;
  };
  const rawOperations =
    operationsFromStore.length > 0
      ? operationsFromStore
      : (effectiveHostId && hostOperations[effectiveHostId]) || [];
  const operations = rawOperations.filter(
    (op) => !isOperationDismissed(op.operation_id, op.revision)
  );
  const hasFinishedOperations = operations.some(
    (op) =>
      op.state === "completed" ||
      op.state === "failed" ||
      op.state === "cancelled" ||
      op.state === "indeterminate"
  );
  const hasActiveOperations = operations.some(
    (op) => op.state === "running" || op.state === "queued" || op.state === "cancelling"
  );
  useEffect(() => {
    if (!effectiveHostId || !hasActiveOperations) return;
    const interval = setInterval(() => {
      void fetchHostOperations(effectiveHostId);
    }, 3000);
    return () => clearInterval(interval);
  }, [effectiveHostId, hasActiveOperations, fetchHostOperations]);
  const validRanks = recommendations.map((r) => r.rank).filter((r): r is number => typeof r === "number" && r > 0);
  const minRank = validRanks.length > 0 ? Math.min(...validRanks) : null;

  const handleHostChange = (newHostId: string) => {
    setSelectedHostId(newHostId);
    setActionError(null);
    onHostChange?.(newHostId);
  };

  const handleLoad = async (artifactId: string) => {
    if (!effectiveHostId) return;
    const targetHostId = effectiveHostId;
    setBusyArtifactId(artifactId);
    setActionError(null);
    try {
      let freshRecs: typeof recommendations;
      try {
        freshRecs = await fetchHostModels(targetHostId);
      } catch {
        setActionError("Failed to refresh recommendations for host; cannot authorize dispatch from stale cache");
        return;
      }
      if (effectiveHostIdRef.current !== targetHostId) {
        setActionError("Host selection changed during recommendation refresh; dispatch aborted");
        return;
      }
      if (!Array.isArray(freshRecs) || freshRecs.length === 0) {
        setActionError("Failed to refresh recommendations for host; cannot authorize dispatch from stale cache");
        return;
      }
      const rec = freshRecs.find((r) => r.artifact_id === artifactId);
      if (!rec) {
        setActionError(`Model '${artifactId}' is no longer recommended on this host`);
        return;
      }
      if (!rec.selectable || !rec.suggested_profile?.profile) {
        setActionError(rec.disabled_reason || `Model '${artifactId}' does not fit or lacks a valid profile on this host`);
        return;
      }
      await dispatchModelOperation(targetHostId, artifactId, {
        kind: "load",
        profile: rec.suggested_profile.profile,
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
  const handleDownload = async (artifactId: string, licenseAccepted = true) => {
    if (!effectiveHostId) return;
    const expectedSha = resolveAuthoritativeModelDigest(artifactId);
    if (!expectedSha) {
      setActionError(`Cannot download: No authoritative catalog digest registered for artifact '${artifactId}'`);
      return;
    }
    setActionError(null);
    try {
      await dispatchModelOperation(effectiveHostId, artifactId, {
        kind: "download",
        expected_sha256: expectedSha,
        license_accepted: licenseAccepted,
      });
      setLicensePromptArtifact(null);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to dispatch download operation");
    } finally {
      setBusyArtifactId(null);
    }
  };

  const handleUnload = async (artifactId: string) => {
    if (!effectiveHostId) return;
    setBusyArtifactId(artifactId);
    setActionError(null);
    try {
      await dispatchModelOperation(effectiveHostId, artifactId, {
        kind: "unload",
      });
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to dispatch unload operation");
    } finally {
      setBusyArtifactId(null);
    }
  };

  const handlePrepareCache = async (artifactId: string, sourceRef?: AppSourceRef, intentRevision?: number) => {
    if (!effectiveHostId) return;
    if (!sourceRef || typeof intentRevision !== "number" || intentRevision <= 0) {
      setActionError("Cannot prepare KV cache: Scoped cache preparation requires an authorized app session source and positive intent revision.");
      return;
    }
    setBusyArtifactId(artifactId);
    setActionError(null);
    try {
      await dispatchModelOperation(effectiveHostId, artifactId, {
        kind: "prepare_kv",
        source_ref: sourceRef,
        intent_revision: intentRevision,
      });
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to dispatch prepare_kv operation");
    } finally {
      setBusyArtifactId(null);
    }
  };

  const handleRetry = async (mutationId: string) => {
    setRetryingMutationId(mutationId);
    setActionError(null);
    try {
      await retryPendingMutation(mutationId);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to retry operation");
    } finally {
      setRetryingMutationId(null);
    }
  };

  const unresolvedMutations = effectiveHostId
    ? Object.values(persistedMutations).filter(
        (m) =>
          m.hostId === effectiveHostId &&
          (m.status === "ambiguous" || m.status === "unknown" || m.status === "failed") &&
          Boolean(m.request)
      )
    : [];

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
      {effectiveHostId && (
        <HostCachePurgeControl
          hostId={effectiveHostId}
          onPurge={purgeHostCache}
          onError={setActionError}
        />
      )}

      {licensePromptArtifact && (
        <div
          className="rounded-lg border border-primary/50 bg-primary/10 p-4 text-xs space-y-3"
          data-testid="license-prompt-dialog"
        >
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-foreground text-sm">Accept License Terms</h4>
            <Badge variant="outline" className="font-mono text-[10px]">{licensePromptArtifact}</Badge>
          </div>
          <p className="text-muted-foreground">
            This model requires accepting its license terms before download and execution. Do you accept the terms?
          </p>
          <div className="flex items-center gap-2 justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setLicensePromptArtifact(null)}
              className="min-h-[44px] px-3"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={busyArtifactId === licensePromptArtifact}
              onClick={() => void handleDownload(licensePromptArtifact, true)}
              className="min-h-[44px] px-4 font-semibold"
              data-testid="accept-license-download-btn"
            >
              {busyArtifactId === licensePromptArtifact ? <Spinner size="sm" className="mr-1" /> : <Check className="mr-1 h-3.5 w-3.5" />}
              Accept & Download
            </Button>
          </div>
        </div>
      )}

      {unresolvedMutations.length > 0 && (
        <div className="space-y-2.5" data-testid="unresolved-mutations-region">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" />
            Unresolved Operations ({unresolvedMutations.length})
          </h3>
          <div className="grid gap-2">
            {unresolvedMutations.map((m) => (
              <div
                key={m.mutationId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs"
                data-testid={`unresolved-mutation-${m.mutationId}`}
              >
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground truncate">{m.artifactId || m.kind}</span>
                    <Badge variant="warning" className="text-[10px] uppercase font-mono">
                      {m.status}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] uppercase font-mono">
                      {m.kind}
                    </Badge>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground truncate">
                    ID: {m.mutationId}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={retryingMutationId === m.mutationId}
                  onClick={() => void handleRetry(m.mutationId)}
                  className="min-h-[44px] px-3 text-xs"
                  data-testid={`retry-mutation-${m.mutationId}`}
                >
                  {retryingMutationId === m.mutationId ? <Spinner size="sm" className="mr-1" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" />}
                  Retry
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

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
      {operations.length > 0 && (
        <div className="space-y-2.5" data-testid="active-operations-region">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Host Operations ({operations.length})
            </h3>
            {hasFinishedOperations && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => clearFinishedHostOperations(effectiveHostId)}
                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                data-testid="clear-finished-operations-button"
              >
                Clear finished
              </Button>
            )}
          </div>
          <div className="grid gap-2">
            {operations.map((op) => (
              <HostOperationProgressCard
                key={op.operation_id}
                operation={op}
                onCancel={handleCancel}
                onDismiss={dismissHostOperation}
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
                <div key={rec.artifact_id} className="space-y-2">
                  <HostModelRecommendationCard
                    recommendation={rec}
                    isTopRanked={isTop}
                    isLoading={busyArtifactId === rec.artifact_id}
                    onLoad={handleLoad}
                    onOpenMultiDeploy={(artId) => setMultiDeployArtifactId(artId)}
                  />
                  <div className="flex flex-wrap items-center justify-end gap-2 px-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busyArtifactId === rec.artifact_id}
                      onClick={() => setLicensePromptArtifact(rec.artifact_id)}
                      className="min-h-[44px] px-3 text-xs"
                      data-testid={`download-btn-${rec.artifact_id}`}
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      Download
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busyArtifactId === rec.artifact_id}
                      onClick={() => void handlePrepareCache(rec.artifact_id)}
                      className="min-h-[44px] px-3 text-xs"
                      data-testid={`prepare-btn-${rec.artifact_id}`}
                    >
                      <Zap className="mr-1.5 h-3.5 w-3.5 text-amber-400" />
                      Prepare KV
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busyArtifactId === rec.artifact_id}
                      onClick={() => void handleUnload(rec.artifact_id)}
                      className="min-h-[44px] px-3 text-xs"
                      data-testid={`unload-btn-${rec.artifact_id}`}
                    >
                      <Square className="mr-1.5 h-3.5 w-3.5" />
                      Unload
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
