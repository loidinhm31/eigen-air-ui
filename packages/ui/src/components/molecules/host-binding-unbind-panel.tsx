import * as React from "react";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";
import { ShieldAlert, Unlink } from "lucide-react";

export interface HostBindingUnbindPanelProps {
  isMutating: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function HostBindingUnbindPanel({
  isMutating,
  onConfirm,
  onCancel,
}: HostBindingUnbindPanelProps) {
  return (
    <div
      role="region"
      aria-label="Unbind confirmation"
      className="mt-1 flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-card-foreground"
      data-testid="unbind-confirmation"
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="space-y-1.5 text-xs">
          <span className="font-semibold text-foreground">Confirm Host Unbinding</span>
          <ul className="space-y-1 text-muted-foreground list-disc pl-4">
            <li>
              <strong className="text-foreground">Scheduling fence & cancel:</strong> Active host execution will be fenced and current pending pool tasks will be cancelled.
            </li>
            <li>
              <strong className="text-foreground">Retained management connection:</strong> The host&apos;s secure management connection and telemetry remain active.
            </li>
            <li>
              <strong className="text-foreground">No implied cache deletion:</strong> Model weights and KV caches are retained on the host and will NOT be deleted.
            </li>
          </ul>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          disabled={isMutating}
          onClick={onCancel}
          className="min-h-[44px] px-3 text-xs"
          data-testid="cancel-unbind-button"
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={isMutating}
          onClick={onConfirm}
          className="min-h-[44px] px-4 text-xs font-semibold"
          data-testid="confirm-unbind-button"
        >
          {isMutating ? <Spinner size="sm" className="mr-1.5" /> : <Unlink className="mr-1.5 h-3.5 w-3.5" />}
          Confirm Unbind
        </Button>
      </div>
    </div>
  );
}
