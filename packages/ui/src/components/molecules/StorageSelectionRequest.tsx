import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Folder } from "lucide-react";
import type {
  StorageRootKind,
  StorageSelectionResponse,
  StorageSelectionStatus,
} from "@eigen-air-ui/shared/types";
import { Badge } from "../atoms/Badge.js";
import { Button } from "../atoms/Button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../atoms/Card.js";
import { StorageSelectionStatusView } from "./storage-selection-status-view.js";
import { isValidOpaqueRootId, sanitizePathText } from "./path-privacy.js";
import { getInferenceService } from "../../adapters/factory/ServiceFactory.js";
import { cn } from "@eigen-air-ui/shared/utils";

export interface StorageSelectionRequestProps {
  readonly deviceId: string;
  readonly deviceName?: string;
  readonly kind?: StorageRootKind;
  readonly label?: string;
  readonly pollIntervalMs?: number;
  readonly onApproved?: (rootId: string) => void;
  readonly onHelpClick?: () => void;
  readonly className?: string;
}

export function StorageSelectionRequest({
  deviceId,
  deviceName,
  kind = "model_root",
  label,
  pollIntervalMs = 1500,
  onApproved,
  onHelpClick,
  className,
}: StorageSelectionRequestProps): React.JSX.Element {
  const [status, setStatus] = useState<StorageSelectionStatus | "idle">("idle");
  const [approvedRootId, setApprovedRootId] = useState<string | null>(null);
  const [approvedLabel, setApprovedLabel] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pollTimerRef = useRef<number | undefined>(undefined);
  const generationRef = useRef<number>(0);
  const activeReqIdRef = useRef<string | null>(null);
  const activeDeviceIdRef = useRef<string>(deviceId);
  const expiresAtMsRef = useRef<number>(0);

  const stopPolling = (): void => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = undefined;
    }
  };

  useEffect(() => {
    if (activeDeviceIdRef.current !== deviceId) {
      generationRef.current += 1;
      stopPolling();
      activeDeviceIdRef.current = deviceId;
      activeReqIdRef.current = null;
      expiresAtMsRef.current = 0;
      setStatus("idle");
      setApprovedRootId(null);
      setApprovedLabel(null);
      setErrorMessage(null);
    }
    return () => {
      generationRef.current += 1;
      stopPolling();
    };
  }, [deviceId]);

  const applyResponse = (res: StorageSelectionResponse, gen: number): boolean => {
    if (gen !== generationRef.current || res.device_id !== deviceId) return false;
    if (res.expires_at_ms > 0) expiresAtMsRef.current = res.expires_at_ms;

    if (expiresAtMsRef.current > 0 && Date.now() > expiresAtMsRef.current) {
      setStatus("expired");
      setErrorMessage("Storage selection request expired");
      return false;
    }

    if (res.status === "approved") {
      if (!isValidOpaqueRootId(res.approved_root_id)) {
        setStatus("failed");
        setErrorMessage("Selection approved without valid storage root ID");
        return false;
      }
      setStatus("approved");
      setApprovedRootId(res.approved_root_id!);
      setApprovedLabel(res.approved_label ? sanitizePathText(res.approved_label) : null);
      onApproved?.(res.approved_root_id!);
      return false;
    }

    if (res.status === "cancelled" || res.status === "expired" || res.status === "failed") {
      setStatus(res.status);
      setErrorMessage(sanitizePathText(res.error_message || `Selection ${res.status}`));
      return false;
    }

    setStatus(res.status);
    return true;
  };

  const scheduleNextPoll = (targetReqId: string, gen: number): void => {
    stopPolling();
    pollTimerRef.current = window.setTimeout(async () => {
      if (gen !== generationRef.current || activeReqIdRef.current !== targetReqId) return;

      try {
        const res: StorageSelectionResponse = await getInferenceService().getDeviceStorageSelection(deviceId, targetReqId);
        if (gen !== generationRef.current || res.request_id !== targetReqId) return;
        const shouldContinue = applyResponse(res, gen);
        if (shouldContinue) scheduleNextPoll(targetReqId, gen);
      } catch (err: unknown) {
        if (gen !== generationRef.current) return;
        if (err && typeof err === "object" && "status" in err && (err.status === 401 || err.status === 404)) {
          setStatus("failed");
          setErrorMessage(
            err.status === 404
              ? "Storage selection request or device not found"
              : "Unauthorized to access storage selection"
          );
          return;
        }
        if (expiresAtMsRef.current > 0 && Date.now() > expiresAtMsRef.current) {
          setStatus("expired");
          setErrorMessage("Storage selection request expired");
          return;
        }
        const msg = err instanceof Error ? err.message : "Polling storage selection failed";
        setErrorMessage(sanitizePathText(msg));
        scheduleNextPoll(targetReqId, gen);
      }
    }, pollIntervalMs);
  };

  const handleStartSelection = async (): Promise<void> => {
    stopPolling();
    generationRef.current += 1;
    const currentGen = generationRef.current;
    setErrorMessage(null);
    setApprovedRootId(null);
    setApprovedLabel(null);
    setStatus("requested");

    try {
      const res: StorageSelectionResponse = await getInferenceService().requestDeviceStorageSelection(
        deviceId,
        kind,
        label
      );
      if (currentGen !== generationRef.current || res.device_id !== deviceId) return;

      activeReqIdRef.current = res.request_id;
      const shouldContinue = applyResponse(res, currentGen);
      if (shouldContinue) scheduleNextPoll(res.request_id, currentGen);
    } catch (err: unknown) {
      if (currentGen !== generationRef.current) return;
      setStatus("failed");
      const msg = err instanceof Error ? err.message : "Requesting storage selection failed";
      setErrorMessage(sanitizePathText(msg));
    }
  };

  const displayDevice = deviceName || deviceId;

  return (
    <Card className={cn("border-border/70 bg-card text-card-foreground shadow-sm", className)}>
      <CardHeader className="space-y-1.5 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Folder className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-semibold">Remote Storage Selection</CardTitle>
          </div>
          <Badge variant="outline" className="text-[10px] font-mono">{kind}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Authorize a storage folder on device <span className="font-semibold text-foreground">{displayDevice}</span>.
          Absolute filesystem paths are never sent to or displayed by the browser.
        </p>
      </CardHeader>

      <CardContent className="space-y-3 text-xs">
        {status === "idle" && (
          <Button size="sm" onClick={handleStartSelection} className="gap-2">
            <Folder className="h-4 w-4" />
            Select Storage Folder on {displayDevice}
          </Button>
        )}

        {status !== "idle" && (
          <StorageSelectionStatusView
            status={status}
            displayDevice={displayDevice}
            approvedRootId={approvedRootId}
            approvedLabel={approvedLabel}
            errorMessage={errorMessage}
            onRetry={handleStartSelection}
            onHelpClick={onHelpClick}
          />
        )}
      </CardContent>
    </Card>
  );
}
