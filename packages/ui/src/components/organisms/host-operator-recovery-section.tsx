import * as React from "react";
import { useEffect, useState } from "react";
import type { ApproveRecoveryRequest, OperatorRecoveryView } from "@eigen-air-ui/shared/types";
import { Badge } from "../atoms/Badge.js";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";
import { AlertCircle, Check, KeyRound, ShieldAlert, X } from "lucide-react";

export interface HostOperatorRecoverySectionProps {
  recoveries: Record<string, OperatorRecoveryView>;
  onApprove: (requestId: string, body?: ApproveRecoveryRequest) => Promise<void>;
  onDeny: (requestId: string, expectedRevision?: number) => Promise<void>;
  onRefresh?: () => Promise<void>;
  className?: string;
}

function sanitizeRecoveryError(err: unknown, defaultMsg: string): string {
  if (!(err instanceof Error) || !err.message) return defaultMsg;
  const raw = err.message;
  // Fail-closed against secret or credential leakage in server error responses
  if (/bearer|token|secret|credential|key|private|hash|auth/i.test(raw)) {
    return `${defaultMsg}: Request rejected by gateway security policy or revision conflict.`;
  }
  return raw;
}

export function HostOperatorRecoverySection({
  recoveries,
  onApprove,
  onDeny,
  onRefresh,
  className = "",
}: HostOperatorRecoverySectionProps) {
  const [busyRequestIds, setBusyRequestIds] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  // Dynamic ticker to ensure expiry state updates accurately without manual refresh
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const recoveryList = Object.values(recoveries).sort((a, b) => b.created_at_ms - a.created_at_ms);

  const handleApprove = async (req: OperatorRecoveryView) => {
    if (req.expiry_ms > 0 && req.expiry_ms < Date.now()) {
      setActionError("Cannot approve: Recovery request has expired.");
      return;
    }
    setBusyRequestIds((prev) => ({ ...prev, [req.request_id]: true }));
    setActionError(null);
    try {
      await onApprove(req.request_id, {
        expected_generation: req.requested_credential_generation,
        expected_revision: req.approval_revision,
      });
    } catch (err: unknown) {
      setActionError(sanitizeRecoveryError(err, "Failed to approve recovery request"));
      if (onRefresh) void onRefresh().catch(() => {});
    } finally {
      setBusyRequestIds((prev) => ({ ...prev, [req.request_id]: false }));
    }
  };

  const handleDeny = async (req: OperatorRecoveryView) => {
    if (req.expiry_ms > 0 && req.expiry_ms < Date.now()) {
      setActionError("Cannot deny: Recovery request has expired.");
      return;
    }
    setBusyRequestIds((prev) => ({ ...prev, [req.request_id]: true }));
    setActionError(null);
    try {
      await onDeny(req.request_id, req.approval_revision);
    } catch (err: unknown) {
      setActionError(sanitizeRecoveryError(err, "Failed to deny recovery request"));
      if (onRefresh) void onRefresh().catch(() => {});
    } finally {
      setBusyRequestIds((prev) => ({ ...prev, [req.request_id]: false }));
    }
  };

  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border border-border/80 bg-card p-4 text-xs text-card-foreground ${className}`}
      data-testid="operator-credential-recovery-section"
    >
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Operator Credential Recovery</h3>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {recoveryList.length} request{recoveryList.length === 1 ? "" : "s"}
        </span>
      </div>

      {actionError && (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/15 p-2 text-xs text-destructive"
          data-testid="recovery-action-error"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {recoveryList.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">No credential recovery requests pending.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {recoveryList.map((req) => {
            const isPending = req.status === "pending_approval";
            const isExpired = req.expiry_ms > 0 && req.expiry_ms < now;
            const isBusy = Boolean(busyRequestIds[req.request_id]);
            const canAct = isPending && !isExpired && !isBusy;

            return (
              <div
                key={req.request_id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-md border border-border/60 bg-background/60 p-3 hover:border-border transition-colors"
                data-testid={`recovery-request-${req.request_id}`}
              >
                <div className="flex flex-col gap-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">Host: {req.host_id}</span>
                    <Badge
                      variant={
                        req.status === "approved" || req.status === "delivered" || req.status === "acknowledged"
                          ? "success"
                          : req.status === "pending_approval"
                            ? isExpired ? "outline" : "warning"
                            : "destructive"
                      }
                      className="text-[10px]"
                    >
                      {isPending && isExpired ? "expired" : req.status}
                    </Badge>
                  </div>

                  {/* Public Key Fingerprint - ZERO secret leakage */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                    <span className="flex items-center gap-1 font-mono text-[11px]">
                      <ShieldAlert className="h-3 w-3 text-primary" />
                      Key: {req.public_key_fingerprint || "—"}
                    </span>
                    <span>Gen: {req.requested_credential_generation}</span>
                    <span>
                      {isExpired
                        ? "Expired"
                        : `Expires in ${Math.max(0, Math.round((req.expiry_ms - now) / 1000))}s`}
                    </span>
                  </div>
                </div>

                {isPending && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!canAct}
                      onClick={() => void handleDeny(req)}
                      className="min-h-[44px] px-3 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                      data-testid={`deny-recovery-${req.request_id}`}
                    >
                      {isBusy ? <Spinner size="sm" className="mr-1" /> : <X className="mr-1 h-3.5 w-3.5" />}
                      Deny
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      disabled={!canAct}
                      onClick={() => void handleApprove(req)}
                      className="min-h-[44px] px-3 text-xs font-semibold"
                      data-testid={`approve-recovery-${req.request_id}`}
                    >
                      {isBusy ? <Spinner size="sm" className="mr-1" /> : <Check className="mr-1 h-3.5 w-3.5" />}
                      Approve
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
