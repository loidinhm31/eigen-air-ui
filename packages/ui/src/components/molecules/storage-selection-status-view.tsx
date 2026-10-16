import * as React from "react";
import { AlertCircle, CheckCircle2, HelpCircle, RefreshCw } from "lucide-react";
import type { StorageSelectionStatus } from "@eigen-air-ui/shared/types";
import { Badge } from "../atoms/Badge.js";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";

export interface StorageSelectionStatusViewProps {
  readonly status: StorageSelectionStatus;
  readonly displayDevice: string;
  readonly approvedRootId: string | null;
  readonly approvedLabel: string | null;
  readonly errorMessage: string | null;
  readonly onRetry: () => void;
  readonly onHelpClick?: () => void;
}

export function StorageSelectionStatusView({
  status,
  displayDevice,
  approvedRootId,
  approvedLabel,
  errorMessage,
  onRetry,
  onHelpClick,
}: StorageSelectionStatusViewProps): React.JSX.Element | null {
  if (status === "requested" || status === "awaiting_local_approval") {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-foreground">
        <div className="flex items-center gap-2">
          <Spinner size="sm" />
          <Badge variant="warning" className="text-xs font-semibold">
            Approve on {displayDevice}
          </Badge>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          A local folder selection prompt has been dispatched. Please approve and choose a directory on{" "}
          <strong>{displayDevice}</strong> to authorize this storage root.
        </p>
      </div>
    );
  }

  if (status === "approved" && approvedRootId) {
    return (
      <div className="space-y-2 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-foreground">
        <div className="flex items-center gap-2 font-semibold text-green-400">
          <CheckCircle2 className="h-4 w-4" />
          <span>Storage Root Approved</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>Root ID:</span>
          <span className="font-mono font-medium text-foreground">{approvedRootId}</span>
          {approvedLabel && <Badge variant="outline" className="text-[10px]">{approvedLabel}</Badge>}
        </div>
      </div>
    );
  }

  if (status === "cancelled" || status === "expired" || status === "failed") {
    return (
      <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <div className="font-semibold capitalize">Storage Selection {status}</div>
            {errorMessage && <p className="text-[11px] text-muted-foreground">{errorMessage}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={onRetry} className="h-7 gap-1.5 text-xs">
            <RefreshCw className="h-3 w-3" />
            Retry Selection
          </Button>
          {onHelpClick && (
            <Button size="sm" variant="ghost" onClick={onHelpClick} className="h-7 gap-1 text-xs">
              <HelpCircle className="h-3.5 w-3.5" />
              Help / Troubleshooting
            </Button>
          )}
        </div>
      </div>
    );
  }

  return null;
}
