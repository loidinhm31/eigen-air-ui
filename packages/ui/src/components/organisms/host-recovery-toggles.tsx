import * as React from "react";
import { useState } from "react";
import type {
  CacheReadinessStatus,
  ClientUpdateRecoveryPreferences,
  HostCacheStatus,
  HostRecoveryPreferences,
  HostRecoveryStatus,
} from "@eigen-air-ui/shared/types";
import { useInferenceStore } from "../../stores/inferenceStore.js";
import { Badge } from "../atoms/Badge.js";
import { CheckCircle2, HardDrive, RotateCcw } from "lucide-react";
import { HostCachePurgeControl } from "./host-cache-purge-control.js";

export interface HostRecoveryTogglesProps {
  hostId: string;
  hostRecovery?: HostRecoveryStatus;
  preferences?: HostRecoveryPreferences;
  caches?: HostCacheStatus[];
  onSavePreferences: (hostId: string, prefs: ClientUpdateRecoveryPreferences) => Promise<unknown>;
  onPurgeCache: (hostId: string) => Promise<unknown>;
}

const CACHE_STATUS_VARIANTS: Record<
  CacheReadinessStatus,
  { variant: "success" | "warning" | "destructive" | "outline"; label: string }
> = {
  ready: { variant: "success", label: "Cache Ready" },
  partial: { variant: "warning", label: "Cache Partial" },
  absent: { variant: "outline", label: "Cache Absent" },
  invalid: { variant: "destructive", label: "Cache Invalid" },
  unsupported: { variant: "outline", label: "Cache Unsupported" },
  pending_purge: { variant: "warning", label: "Cache Pending Purge" },
};

export function HostRecoveryToggles({
  hostId,
  hostRecovery,
  preferences,
  caches = [],
  onSavePreferences,
  onPurgeCache,
}: HostRecoveryTogglesProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const autoLoadModel = preferences?.auto_load_model ?? hostRecovery?.auto_load_model ?? false;
  const autoPrepareKv = preferences?.auto_prepare_kv ?? hostRecovery?.auto_prepare_kv ?? false;

  const handleToggle = async (key: "auto_load_model" | "auto_prepare_kv", nextVal: boolean) => {
    if (isSaving) return;
    setError(null);
    setIsSaving(true);

    try {
      const latestPrefs = useInferenceStore.getState().hostPreferences[hostId] ?? preferences;
      const expectedRevision = latestPrefs?.expected_revision ?? hostRecovery?.desired_revision ?? 0;
      const currentAutoLoad = latestPrefs?.auto_load_model ?? autoLoadModel;
      const currentAutoPrepare = latestPrefs?.auto_prepare_kv ?? autoPrepareKv;

      const nextPrefs: ClientUpdateRecoveryPreferences = {
        expected_revision: expectedRevision,
        auto_load_model: key === "auto_load_model" ? nextVal : currentAutoLoad,
        auto_prepare_kv: key === "auto_prepare_kv" ? nextVal : currentAutoPrepare,
      };

      await onSavePreferences(hostId, nextPrefs);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save recovery preference (CAS mismatch)");
      void useInferenceStore.getState().fetchHostPreferences(hostId).catch(() => {});
    } finally {
      setIsSaving(false);
    }
  };

  const primaryCache = caches.length > 0 ? caches[0] : null;
  const cacheStatusKey: CacheReadinessStatus = primaryCache
    ? primaryCache.status
    : hostRecovery?.cache_ready
      ? "ready"
      : "absent";
  const cacheMeta = CACHE_STATUS_VARIANTS[cacheStatusKey] ?? { variant: "outline", label: cacheStatusKey };
  const isModelReady = hostRecovery?.model_ready ?? false;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card/40 p-3.5 text-xs text-card-foreground">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2.5">
        <div className="flex items-center gap-2">
          <RotateCcw className="h-4 w-4 text-primary" />
          <span className="font-semibold text-foreground">Recovery & Readiness</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant={isModelReady ? "success" : "outline"}
            className="flex items-center gap-1"
            data-testid="model-readiness-badge"
          >
            {isModelReady ? <CheckCircle2 className="h-3 w-3" /> : <HardDrive className="h-3 w-3" />}
            <span>
              {isModelReady
                ? "Model Ready"
                : hostRecovery?.model_action
                  ? `Model: ${hostRecovery.model_action}`
                  : "Model Absent"}
            </span>
          </Badge>
          <Badge
            variant={cacheMeta.variant}
            className="flex items-center gap-1"
            data-testid="cache-readiness-badge"
          >
            <span>{cacheMeta.label}</span>
          </Badge>
        </div>
      </div>

      {/* Independent Toggles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <label className="flex items-center justify-between gap-3 p-2.5 rounded-md border border-border/60 bg-background/50 hover:bg-background/80 transition-colors cursor-pointer min-h-[44px]">
          <div className="flex flex-col">
            <span className="font-medium text-foreground">Auto-reload model</span>
            <span className="text-[11px] text-muted-foreground">Automatically reload selected model</span>
          </div>
          <input
            type="checkbox"
            checked={autoLoadModel}
            disabled={isSaving}
            onChange={(e) => void handleToggle("auto_load_model", e.target.checked)}
            className="h-5 w-5 rounded border-border text-primary focus:ring-primary cursor-pointer disabled:opacity-50"
            data-testid="toggle-auto-load-model"
          />
        </label>

        <label className="flex items-center justify-between gap-3 p-2.5 rounded-md border border-border/60 bg-background/50 hover:bg-background/80 transition-colors cursor-pointer min-h-[44px]">
          <div className="flex flex-col">
            <span className="font-medium text-foreground">Auto-prepare KV</span>
            <span className="text-[11px] text-muted-foreground">Automatically prepare/restore KV</span>
          </div>
          <input
            type="checkbox"
            checked={autoPrepareKv}
            disabled={isSaving}
            onChange={(e) => void handleToggle("auto_prepare_kv", e.target.checked)}
            className="h-5 w-5 rounded border-border text-primary focus:ring-primary cursor-pointer disabled:opacity-50"
            data-testid="toggle-auto-prepare-kv"
          />
        </label>
      </div>

      {/* Cache Purge Control */}
      <HostCachePurgeControl hostId={hostId} onPurge={onPurgeCache} onError={setError} />

      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-md border border-destructive/40 bg-destructive/15 p-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}
    </div>
  );
}
