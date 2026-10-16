import * as React from "react";
import { useState } from "react";
import type { ModelInventoryItem, StorageRootDescriptor } from "@eigen-air-ui/shared/types";
import { Badge } from "../atoms/Badge.js";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface ServerModelsViewProps {
  models: ModelInventoryItem[];
  roots: StorageRootDescriptor[];
  selectedRootId: string | null;
  loading: boolean;
  onSelectRoot: (rootId: string) => Promise<void>;
  onDownload: (artifactId: string) => Promise<void>;
  onDelete: (artifactId: string) => Promise<void>;
  onLoad: (artifactId: string) => Promise<void>;
  onUnload: (artifactId: string) => Promise<void>;
  onPrepareCache: (artifactId: string) => Promise<void>;
  onPurgeCache: (artifactId: string) => Promise<void>;
}

export function ServerModelsView({
  models,
  roots,
  selectedRootId,
  loading,
  onSelectRoot,
  onDownload,
  onDelete,
  onLoad,
  onUnload,
  onPrepareCache,
  onPurgeCache,
}: ServerModelsViewProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [licensePromptArtifact, setLicensePromptArtifact] = useState<string | null>(null);
  const [deleteConfirmArtifact, setDeleteConfirmArtifact] = useState<string | null>(null);

  async function handleAction(id: string, action: () => Promise<void>) {
    setBusyId(id);
    try {
      await action();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6 text-sm">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Shared Server Models
          </h3>
          {loading && <Spinner size="sm" />}
        </div>
        <div className="grid gap-3">
          {models.length === 0 && !loading && (
            <p className="text-xs text-muted-foreground">No server models found.</p>
          )}
          {models.map((m) => (
            <div
              key={m.artifact_id}
              className="flex flex-col gap-2 rounded-md border border-border/70 bg-card p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{m.display_name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {m.family}
                    </Badge>
                    <Badge variant="default" className="text-[10px]">
                      {m.quantization}
                    </Badge>
                  </div>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span>Installed: {m.installed ? formatBytes(m.installed_bytes) : "No"}</span>
                    <span>Loaded: {m.is_loaded ? "Yes" : "No"}</span>
                    <span>KV Cache: {m.has_kv_cache ? "Prepared" : "None"}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {!m.installed ? (
                    <Button
                      size="sm"
                      isLoading={busyId === m.artifact_id}
                      onClick={() => setLicensePromptArtifact(m.artifact_id)}
                    >
                      Download
                    </Button>
                  ) : (
                    <>
                      {m.is_loaded ? (
                        <Button
                          size="sm"
                          variant="outline"
                          isLoading={busyId === m.artifact_id}
                          onClick={() => handleAction(m.artifact_id, () => onUnload(m.artifact_id))}
                        >
                          Unload
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          isLoading={busyId === m.artifact_id}
                          onClick={() => handleAction(m.artifact_id, () => onLoad(m.artifact_id))}
                        >
                          Load
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        isLoading={busyId === m.artifact_id}
                        onClick={() => handleAction(m.artifact_id, () => onPrepareCache(m.artifact_id))}
                      >
                        Prepare KV
                      </Button>
                      {m.has_kv_cache && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive"
                          isLoading={busyId === m.artifact_id}
                          onClick={() => handleAction(m.artifact_id, () => onPurgeCache(m.artifact_id))}
                        >
                          Purge KV
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteConfirmArtifact(m.artifact_id)}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {licensePromptArtifact === m.artifact_id && (
                <div className="mt-2 rounded border border-primary/40 bg-primary/5 p-2.5 text-xs space-y-2">
                  <p className="font-medium text-foreground">
                    Accept License Terms {m.license && `(${m.license})`}
                  </p>
                  <p className="text-muted-foreground">
                    Downloading {m.display_name} requires agreement to the publisher terms of use ({m.license ?? "license terms"}).
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setLicensePromptArtifact(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      isLoading={busyId === m.artifact_id}
                      onClick={async () => {
                        setLicensePromptArtifact(null);
                        await handleAction(m.artifact_id, () => onDownload(m.artifact_id));
                      }}
                    >
                      Accept & Download
                    </Button>
                  </div>
                </div>
              )}

              {deleteConfirmArtifact === m.artifact_id && (
                <div className="mt-2 rounded border border-destructive/40 bg-destructive/5 p-2.5 text-xs space-y-2">
                  <p className="font-medium text-destructive">Confirm Model Deletion</p>
                  <p className="text-muted-foreground">
                    Deleting this model removes its weights from shared server storage and disrupts
                    other users relying on this artifact.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleteConfirmArtifact(null)}
                    >
                      Keep Model
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      isLoading={busyId === m.artifact_id}
                      onClick={async () => {
                        setDeleteConfirmArtifact(null);
                        await handleAction(m.artifact_id, () => onDelete(m.artifact_id));
                      }}
                    >
                      Confirm Delete
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Storage Roots
        </h3>
        <p className="text-xs text-muted-foreground">
          Root registration is operator-only. All authenticated human users may select already registered roots.
        </p>
        <div className="grid gap-2">
          {roots.map((r) => {
            const isSelected = selectedRootId === r.root_id;
            return (
              <div
                key={r.root_id}
                className="flex items-center justify-between rounded-md border border-border/70 bg-card p-3 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.display_label}</span>
                    {isSelected && <Badge variant="default" className="text-[10px]">Active</Badge>}
                    {r.is_removable && <Badge variant="outline" className="text-[10px]">Removable</Badge>}
                  </div>
                  <p className="text-muted-foreground">
                    Available: {formatBytes(r.available_bytes)} / {formatBytes(r.total_bytes)}
                  </p>
                </div>
                {!isSelected && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onSelectRoot(r.root_id)}
                  >
                    Select Root
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
