import * as React from "react";
import { useState } from "react";
import type { PoolBinding } from "@eigen-air-ui/shared/types";
import { useInferenceStore } from "../../stores/inferenceStore.js";
import { Badge } from "../atoms/Badge.js";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";
import { AlertTriangle, CheckCircle2, Link2, RefreshCw, Unlink } from "lucide-react";
import { HostBindingUnbindPanel } from "./host-binding-unbind-panel.js";

export interface HostBindingControlsProps {
  hostId: string;
  currentBinding?: PoolBinding | null;
  appliedRevision?: number;
  disabled?: boolean;
  className?: string;
}

export function HostBindingControls({
  hostId,
  currentBinding,
  appliedRevision,
  disabled = false,
  className = "",
}: HostBindingControlsProps) {
  const { pools, mutateBinding, unbindHost } = useInferenceStore();

  const poolList = Object.values(pools);
  const activePoolId = currentBinding?.pool_id ?? "";
  const bindingState = currentBinding?.state ?? "unbound";

  const defaultSelectedPool = activePoolId || (poolList.length > 0 ? poolList[0].pool_id : "default");
  const [selectedPoolId, setSelectedPoolId] = useState<string>(defaultSelectedPool);
  const [showUnbindConfirm, setShowUnbindConfirm] = useState<boolean>(false);
  const [isMutating, setIsMutating] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  React.useEffect(() => {
    if (activePoolId) setSelectedPoolId(activePoolId);
  }, [activePoolId]);
  const effectiveRevision = currentBinding?.revision ?? appliedRevision;

  async function handleBind() {
    if (!selectedPoolId) return;
    setIsMutating(true);
    setActionError(null);
    try {
      await mutateBinding(hostId, selectedPoolId, effectiveRevision);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to bind host to pool");
    } finally {
      setIsMutating(false);
    }
  }

  async function handleConfirmUnbind() {
    setIsMutating(true);
    setActionError(null);
    try {
      await unbindHost(hostId, effectiveRevision);
      setShowUnbindConfirm(false);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Failed to unbind host from pool");
    } finally {
      setIsMutating(false);
    }
  }
  const isBound = bindingState === "bound";
  const isDraining = bindingState === "draining";
  const isUnbound = bindingState === "unbound" || !currentBinding;

  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border border-border/70 bg-card/60 p-3.5 text-xs text-card-foreground ${className}`}
      data-testid="host-binding-controls"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" />
          <span className="font-semibold text-foreground">Pool Binding</span>
        </div>
        <div>
          {currentBinding && isBound && (
            <Badge variant="success" className="flex items-center gap-1.5" data-testid="binding-badge-bound">
              <CheckCircle2 className="h-3 w-3" />
              <span>Bound: {currentBinding.pool_id}</span>
            </Badge>
          )}
          {currentBinding && isDraining && (
            <Badge variant="warning" className="flex items-center gap-1.5" data-testid="binding-badge-draining">
              <RefreshCw className="h-3 w-3 animate-spin" />
              <span>Draining: {currentBinding.pool_id}</span>
            </Badge>
          )}
          {isUnbound && (
            <Badge variant="outline" className="flex items-center gap-1.5 text-muted-foreground" data-testid="binding-badge-unbound">
              <span>Unbound</span>
            </Badge>
          )}
        </div>
      </div>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        <div className="flex-1 min-w-0">
          <label htmlFor={`pool-select-${hostId}`} className="sr-only">
            Select Inference Pool
          </label>
          <select
            id={`pool-select-${hostId}`}
            value={selectedPoolId}
            disabled={disabled || isMutating || showUnbindConfirm}
            onChange={(e) => setSelectedPoolId(e.target.value)}
            className="w-full min-h-[44px] rounded-md border border-input bg-background/80 px-3 py-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="pool-select"
          >
            {poolList.length === 0 ? (
              <option value="default">default (Default Pool)</option>
            ) : (
              poolList.map((p) => (
                <option key={p.pool_id} value={p.pool_id}>
                  {p.pool_id} ({p.ready_hosts} ready / {p.busy_hosts} busy)
                </option>
              ))
            )}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(isUnbound || (isBound && selectedPoolId !== activePoolId)) && (
            <Button
              type="button"
              variant="default"
              disabled={disabled || isMutating || !selectedPoolId}
              onClick={() => void handleBind()}
              className="min-h-[44px] px-4 font-medium"
              data-testid="bind-button"
            >
              {isMutating ? <Spinner size="sm" className="mr-1.5" /> : <Link2 className="mr-1.5 h-3.5 w-3.5" />}
              {isBound ? "Change Pool" : "Bind to Pool"}
            </Button>
          )}

          {(isDraining || (isUnbound && activePoolId)) && (
            <Button
              type="button"
              variant="outline"
              disabled={disabled || isMutating || !selectedPoolId}
              onClick={() => void handleBind()}
              className="min-h-[44px] px-4 border-primary/50 text-primary hover:bg-primary/10"
              data-testid="rebind-button"
            >
              {isMutating ? <Spinner size="sm" className="mr-1.5" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Rebind
            </Button>
          )}

          {(isBound || isDraining) && !showUnbindConfirm && (
            <Button
              type="button"
              variant="outline"
              disabled={disabled || isMutating}
              onClick={() => setShowUnbindConfirm(true)}
              className="min-h-[44px] px-4 border-destructive/50 text-destructive hover:bg-destructive/10"
              data-testid="unbind-button"
            >
              <Unlink className="mr-1.5 h-3.5 w-3.5" />
              Unbind
            </Button>
          )}
        </div>
      </div>
      {showUnbindConfirm && (
        <HostBindingUnbindPanel
          isMutating={isMutating}
          onConfirm={() => void handleConfirmUnbind()}
          onCancel={() => setShowUnbindConfirm(false)}
        />
      )}
      {actionError && (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/15 p-2.5 text-xs text-destructive"
          data-testid="binding-action-error"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
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
    </div>
  );
}
