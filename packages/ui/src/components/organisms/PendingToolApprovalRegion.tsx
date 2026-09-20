import * as React from "react";
import {
  getChatService,
  getServiceAccessContext,
  getToolApprovalService,
} from "../../adapters/factory/ServiceFactory.js";
import type { IToolApprovalService } from "../../adapters/factory/interfaces/IToolApprovalService.js";
import type { IChatService } from "../../adapters/factory/interfaces/IChatService.js";
import { ToolApprovalCard } from "../molecules/ToolApprovalCard.js";
import { ToolApprovalController } from "./toolApprovalController.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { pendingApprovalSnapshot, useToolApprovalStore } from "../../stores/toolApprovalStore.js";

function tryGetToolApprovalService(daemonUrl: string): IToolApprovalService | undefined {
  void daemonUrl;
  try {
    return getToolApprovalService();
  } catch {
    return undefined;
  }
}

function tryGetChatService(daemonUrl: string): IChatService | undefined {
  void daemonUrl;
  try {
    return getChatService();
  } catch {
    return undefined;
  }
}

export function PendingToolApprovalRegion() {
  const daemonUrl = useConnectionStore((state) => state.url);
  const sessionId = useConnectionStore((state) => state.sessionId);
  const connectionStatus = useConnectionStore((state) => state.status);
  const [activeRunId, setActiveRunId] = React.useState<string | undefined>(
    () => useToolApprovalStore.getState().context?.runId
  );
  const activeRunIdRef = React.useRef<string | undefined>(activeRunId);
  activeRunIdRef.current = activeRunId;

  const accessContext = getServiceAccessContext();
  const identityKey = accessContext.identityKey;
  const accessRevision = accessContext.accessRevision;

  const service = React.useMemo(() => tryGetToolApprovalService(daemonUrl), [daemonUrl]);
  const chatService = React.useMemo(() => tryGetChatService(daemonUrl), [daemonUrl]);
  const store = useToolApprovalStore();

  const controller = React.useMemo(
    () => (service ? new ToolApprovalController({ service }) : undefined),
    [service]
  );

  const latestContextRef = React.useRef({
    daemonUrl,
    sessionId,
    identityKey,
    accessRevision,
    service,
    connectionStatus,
  });
  latestContextRef.current = {
    daemonUrl,
    sessionId,
    identityKey,
    accessRevision,
    service,
    connectionStatus,
  };

  // Clear run ID when session changes
  const previousSessionId = React.useRef(sessionId);
  if (previousSessionId.current !== sessionId) {
    previousSessionId.current = sessionId;
    activeRunIdRef.current = undefined;
    if (activeRunId !== undefined) {
      setActiveRunId(undefined);
    }
  }

  const syncControllerContext = React.useCallback(
    (targetRunId: string | undefined) => {
      if (!controller) return;
      const ctx = latestContextRef.current;
      if (ctx.sessionId && targetRunId && ctx.service) {
        controller.setContext({
          daemonUrl: ctx.daemonUrl,
          sessionId: ctx.sessionId,
          runId: targetRunId,
          ...(ctx.identityKey ? { identityKey: ctx.identityKey } : {}),
          ...(ctx.accessRevision !== undefined ? { accessRevision: ctx.accessRevision } : {}),
        });
        controller.onConnectionStatus(ctx.connectionStatus);
      } else {
        controller.setContext(undefined);
      }
    },
    [controller]
  );

  React.useEffect(() => {
    syncControllerContext(activeRunIdRef.current);
  }, [syncControllerContext, sessionId, daemonUrl, identityKey, accessRevision, service, connectionStatus]);
  React.useEffect(() => {
    if (!controller || !chatService) return;
    const unsubscribers: Array<() => void> = [];

    if (chatService.subscribeRunCorrelation) {
      unsubscribers.push(
        chatService.subscribeRunCorrelation((event) => {
          // Strictly verify event belongs to current session
          const ctx = latestContextRef.current;
          if (event.session_id && event.session_id !== ctx.sessionId) return;
          const incomingRunId = event.run_id;
          if (incomingRunId) {
            activeRunIdRef.current = incomingRunId;
            setActiveRunId(incomingRunId);
            syncControllerContext(incomingRunId);
          }
        })
      );
    }

    if (chatService.subscribeToolApproval) {
      unsubscribers.push(
        chatService.subscribeToolApproval((event) => {
          // Strictly ignore foreign session approval hints
          const ctx = latestContextRef.current;
          if (event.session_id && event.session_id !== ctx.sessionId) return;
          const incomingRunId = event.run_id ?? activeRunIdRef.current;
          if (incomingRunId) {
            activeRunIdRef.current = incomingRunId;
            setActiveRunId(incomingRunId);
            syncControllerContext(incomingRunId);
          }
          controller.onApprovalHint(event);
        })
      );
    }

    if (chatService.onToolApprovalProtocolError) {
      unsubscribers.push(
        chatService.onToolApprovalProtocolError(() => controller.onApprovalHint())
      );
    }

    if (chatService.onRunReconnect) {
      unsubscribers.push(
        chatService.onRunReconnect(() => void controller.refresh())
      );
    }

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [chatService, controller, sessionId, syncControllerContext]);

  React.useEffect(() => {
    return () => controller?.dispose();
  }, [controller]);

  const pending = pendingApprovalSnapshot(store);
  if (!pending || !controller) {
    return null;
  }

  const approvalId = pending.approval_id;
  const isSubmitting = store.status === "submitting" && store.mutationApprovalId === approvalId;
  const isReconciling = store.status === "reconciling";
  const isOffline = store.status === "offline";
  const isAccepted = controller.isAccepted(approvalId);
  const canMutate = controller.canMutate(approvalId);

  return (
    <div className="my-2">
      <ToolApprovalCard
        approval={pending}
        onAllowOnce={() => void controller.resolve(approvalId, "allow_once")}
        onDeny={() => void controller.resolve(approvalId, "deny")}
        disabled={!canMutate}
        submitting={isSubmitting}
        reconciling={isReconciling}
        offline={isOffline}
        accepted={isAccepted}
        error={store.error}
      />
    </div>
  );
}
