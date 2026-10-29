import * as React from "react";
import { useState } from "react";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";
import { Trash2, Zap } from "lucide-react";

export interface HostCachePurgeControlProps {
  hostId: string;
  onPurge: (hostId: string, payload?: { session_id?: string; mutation_id?: string }) => Promise<unknown>;
  onError: (msg: string) => void;
}

export function HostCachePurgeControl({ hostId, onPurge, onError }: HostCachePurgeControlProps) {
  const [isPurging, setIsPurging] = useState(false);
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const [targetSessionId, setTargetSessionId] = useState("");

  const handlePurge = async () => {
    setIsPurging(true);
    try {
      if (targetSessionId.trim()) {
        await onPurge(hostId, { session_id: targetSessionId.trim() });
      } else {
        await onPurge(hostId);
      }
      setPurgeConfirm(false);
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to purge host cache");
    } finally {
      setIsPurging(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/40">
      <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Zap className="h-3.5 w-3.5 text-amber-400" />
        <span>Local KV cache and context tensors stored on host</span>
      </div>
      {purgeConfirm ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-amber-400">Purge all cache?</span>
          <input
            type="text"
            value={targetSessionId}
            onChange={(e) => setTargetSessionId(e.target.value)}
            placeholder="Session scope (default)"
            className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground w-40"
            data-testid="purge-session-scope-input"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPurging}
            onClick={() => setPurgeConfirm(false)}
            className="min-h-[44px] px-3 text-xs"
            data-testid="cancel-purge-cache-button"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={isPurging}
            onClick={() => void handlePurge()}
            className="min-h-[44px] px-3 text-xs font-semibold"
            data-testid="confirm-purge-cache-button"
          >
            {isPurging ? <Spinner size="sm" className="mr-1.5" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
            Confirm Purge
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPurgeConfirm(true)}
          className="min-h-[44px] px-3 border-destructive/40 text-destructive hover:bg-destructive/10"
          data-testid="purge-cache-button"
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Purge Cache
        </Button>
      )}
    </div>
  );
}
