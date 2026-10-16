import * as React from "react";
import { useState } from "react";
import type {
  ConfiguredStorageRoot,
  LocalCompanionStatus,
  PublicDeviceSummary,
} from "@eigen-air-ui/shared/types";
import { Badge } from "../atoms/Badge.js";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";

export interface CompanionDeviceViewProps {
  status: LocalCompanionStatus | null;
  roots: ConfiguredStorageRoot[];
  devices: PublicDeviceSummary[];
  loading: boolean;
  onStartCompanion: () => Promise<void>;
  onStopCompanion: () => Promise<void>;
  onPickFolder: () => Promise<{ path: string; cancelled?: boolean }>;
  onRevokeDevice: (deviceId: string) => Promise<void>;
  onRetireDevice: (deviceId: string, archiveWarning: boolean) => Promise<void>;
  onUnpairLocal: (deviceId?: string, deleteCaches?: boolean) => Promise<{ cleanup_state: string; credentials_wiped: boolean } | null>;
}

export function CompanionDeviceView({
  status,
  roots,
  devices,
  loading,
  onStartCompanion,
  onStopCompanion,
  onPickFolder,
  onRevokeDevice,
  onRetireDevice,
  onUnpairLocal,
}: CompanionDeviceViewProps) {
  const [unpairModalDevice, setUnpairModalDevice] = useState<string | null>(null);
  const [deleteCaches, setDeleteCaches] = useState(true);
  const [retireConfirmDevice, setRetireConfirmDevice] = useState<string | null>(null);
  const [cleanupOutcome, setCleanupOutcome] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isRunning = status && status.status !== "stopped";

  return (
    <div className="space-y-6 text-sm">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Local Desktop Companion
          </h3>
          {loading && <Spinner size="sm" />}
        </div>

        <div className="rounded-md border border-border/70 bg-card p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-medium">Companion Controller</span>
              <Badge variant={isRunning ? "default" : "outline"} className="text-[10px]">
                {status ? status.status : "unavailable"}
              </Badge>
              {status?.version && (
                <span className="text-xs text-muted-foreground">v{status.version}</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isRunning ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onStopCompanion();
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Stop Companion
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onStartCompanion();
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Start Companion
                </Button>
              )}
            </div>
          </div>

          <div className="border-t border-border/50 pt-2 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium">Local Storage Root</p>
                <p className="text-xs text-muted-foreground">
                  {roots.length > 0
                    ? roots.map((r) => r.path).join(", ")
                    : "No local folder configured"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={onPickFolder}>
                  Choose Folder...
                </Button>
                {status && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => setUnpairModalDevice("local")}
                  >
                    Unpair Local
                  </Button>
                )}
              </div>
            </div>
            {cleanupOutcome && (
              <div role="status" className="rounded bg-muted/50 p-2 text-xs font-medium text-foreground">
                {cleanupOutcome}
              </div>
            )}
          </div>
          {unpairModalDevice === "local" && (
            <div className="mt-2 rounded border border-border/70 bg-muted/30 p-2.5 space-y-2">
              <p className="font-medium">Unpair Local Companion</p>
              <p className="text-muted-foreground">
                Unpairing wipes authentication secrets unconditionally even if offline.
              </p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteCaches}
                  onChange={(e) => setDeleteCaches(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border"
                />
                <span>Delete managed prompt/history caches on this device (recommended)</span>
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setUnpairModalDevice(null)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={async () => {
                    setUnpairModalDevice(null);
                    try {
                      const res = await onUnpairLocal(undefined, deleteCaches);
                      if (res) {
                        setCleanupOutcome(
                          `Local credentials wiped: ${res.credentials_wiped ? "Yes" : "No"}. Cache cleanup: ${res.cleanup_state}.`
                        );
                      } else {
                        setCleanupOutcome("Local companion unavailable: local unpair could not be executed.");
                      }
                    } catch (err) {
                      setCleanupOutcome(`Unpair error: ${err instanceof Error ? err.message : String(err)}`);
                    }
                  }}
                >
                  Confirm Local Unpair
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Paired Companion Devices
        </h3>

        {devices.length === 0 && (
          <p className="text-xs text-muted-foreground">No companion devices paired to this account.</p>
        )}

        <div className="grid gap-2">
          {devices.map((d) => (
            <div
              key={d.device_id}
              className="flex flex-col gap-2 rounded-md border border-border/70 bg-card p-3 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{d.display_label}</span>
                    <Badge
                      variant={d.status === "active" ? "default" : "outline"}
                      className="text-[10px]"
                    >
                      {d.status}
                    </Badge>
                    {d.warning_archived && (
                      <Badge variant="outline" className="text-[10px]">
                        deletion unverified (archived)
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground">
                    Device ID: {d.device_id.slice(0, 16)}... | Revision: {d.revision}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {d.status === "active" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={async () => {
                        await onRevokeDevice(d.device_id);
                        setCleanupOutcome(`Device '${d.display_label}' revoked on server.`);
                      }}
                    >
                      Revoke
                    </Button>
                  )}
                  {d.status !== "retired" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRetireConfirmDevice(d.device_id)}
                    >
                      Retire
                    </Button>
                  )}
                </div>
              </div>

              {retireConfirmDevice === d.device_id && (
                <div className="mt-2 rounded border border-border/70 bg-muted/30 p-2.5 space-y-2">
                  <p className="font-medium">Retire Offline/Lost Device</p>
                  <p className="text-muted-foreground">
                    Retirement archives cleanup warnings while preserving an unverified deletion
                    record and durable tombstones, preventing old caches from ever being reused.
                  </p>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRetireConfirmDevice(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={async () => {
                        setRetireConfirmDevice(null);
                        await onRetireDevice(d.device_id, true);
                      }}
                    >
                      Confirm Retire
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
