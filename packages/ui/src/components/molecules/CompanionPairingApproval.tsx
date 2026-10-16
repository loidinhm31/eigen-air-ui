import * as React from "react";
import { useState } from "react";
import { AlertCircle, CheckCircle2, KeyRound, Server, Shield, User } from "lucide-react";
import { Badge } from "../atoms/Badge.js";
import { Button } from "../atoms/Button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../atoms/Card.js";
import { Input } from "../atoms/Input.js";
import { Spinner } from "../atoms/Spinner.js";
import { getInferenceService } from "../../adapters/factory/ServiceFactory.js";
import { resolvePairingError, type PairingResolutionOutcome } from "./companion-pairing-errors.js";
import { cn } from "@eigen-air-ui/shared/utils";

export interface CompanionPairingApprovalProps {
  readonly serverHost: string;
  readonly accountLabel: string;
  readonly initialPairingId?: string;
  readonly onSuccess?: (pairingId: string) => void;
  readonly onError?: (errorMessage: string) => void;
  readonly className?: string;
}

export function CompanionPairingApproval({
  serverHost,
  accountLabel,
  initialPairingId = "",
  onSuccess,
  onError,
  className,
}: CompanionPairingApprovalProps): React.JSX.Element {
  const [pairingId, setPairingId] = useState<string>(initialPairingId);
  const [code, setCode] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [isApproved, setIsApproved] = useState<boolean>(false);
  const [isTerminal, setIsTerminal] = useState<boolean>(false);

  const normalizedCode = code.replace(/[\s-]/g, "").toUpperCase();
  const trimmedPairingId = pairingId.trim();
  const isFormValid = trimmedPairingId.length > 0 && normalizedCode.length === 6 && !isTerminal;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!isFormValid || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setRemainingAttempts(null);

    try {
      const response = await getInferenceService().approvePairing(trimmedPairingId, normalizedCode);
      if (response && response.status === "approved") {
        setIsApproved(true);
        onSuccess?.(trimmedPairingId);
      } else {
        throw new Error("Approval response status was not approved");
      }
    } catch (err: unknown) {
      const outcome: PairingResolutionOutcome = resolvePairingError(err);
      setErrorMessage(outcome.message);
      setRemainingAttempts(outcome.remainingAttempts);
      if (outcome.isTerminal) setIsTerminal(true);
      onError?.(outcome.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className={cn("border-border/70 bg-card text-card-foreground shadow-sm", className)}>
      <CardHeader className="space-y-1.5 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-semibold">Companion Pairing Approval</CardTitle>
          </div>
          <Badge variant="outline" className="text-[10px]">Challenge-Response</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Authorize an active companion pairing session. Enter the 6-character verification code displayed on your device.
        </p>
      </CardHeader>

      <CardContent className="space-y-4 text-xs">
        {/* Owner Information Display */}
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 bg-muted/30 p-2.5">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Server className="h-3.5 w-3.5 text-foreground" />
            <span className="font-medium text-foreground">Server:</span>
            <span>{serverHost}</span>
          </div>
          <span className="text-muted-foreground/40">•</span>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <User className="h-3.5 w-3.5 text-foreground" />
            <span className="font-medium text-foreground">Account:</span>
            <span>{accountLabel}</span>
          </div>
        </div>

        {/* Pairing Success Notice */}
        {isApproved && (
          <div className="space-y-2 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-foreground">
            <div className="flex items-center gap-2 font-semibold text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              <span>Pairing Approved on Server</span>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Server authorization recorded. <strong>Physical local confirmation required:</strong> Please accept the
              incoming pairing prompt on your companion device window or console to finalize credentials and establish connection.
            </p>
          </div>
        )}

        {/* Error Display */}
        {errorMessage && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-0.5">
              <div className="font-semibold">{errorMessage}</div>
              {remainingAttempts !== null && remainingAttempts > 0 && (
                <div className="text-[11px] text-muted-foreground">
                  You have {remainingAttempts} attempt{remainingAttempts === 1 ? "" : "s"} remaining before this flow is locked.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pairing Form */}
        {!isApproved && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="pairing-id-input" className="font-medium text-foreground">Pairing ID</label>
              <Input
                id="pairing-id-input"
                type="text"
                value={pairingId}
                disabled={isSubmitting || isTerminal}
                placeholder="pair_xxxxxxxxxxxx"
                className="font-mono text-xs"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPairingId(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="pairing-code-input" className="font-medium text-foreground">6-Digit Verification Code</label>
              <Input
                id="pairing-code-input"
                type="text"
                value={code}
                disabled={isSubmitting || isTerminal}
                placeholder="ABC-123 or ABC123"
                maxLength={8}
                className="font-mono text-sm uppercase tracking-widest"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value)}
              />
              <span className="text-[10px] text-muted-foreground">
                Spaces and dashes are automatically trimmed.
              </span>
            </div>

            <Button
              type="submit"
              size="sm"
              disabled={!isFormValid || isSubmitting}
              className="w-full gap-1.5 font-medium"
            >
              {isSubmitting ? (
                <>
                  <Spinner size="sm" />
                  Approving Pairing...
                </>
              ) : (
                "Approve Companion Pairing"
              )}
            </Button>
          </form>
        )}

        {/* Security Notice */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Shield className="h-3.5 w-3.5 text-primary" />
          <span>No companion tokens or secrets are stored or accessible within this browser session.</span>
        </div>
      </CardContent>
    </Card>
  );
}
