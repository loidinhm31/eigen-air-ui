import * as React from "react";
import {
  getChatService,
  getServiceAccessContext,
  getRunService,
  getUserQuestionService,
} from "../../adapters/factory/ServiceFactory.js";
import type { IUserQuestionService } from "../../adapters/factory/interfaces/IUserQuestionService.js";
import type { IChatService } from "../../adapters/factory/interfaces/IChatService.js";
import { UserQuestionCard } from "./UserQuestionCard.js";
import { UserQuestionController } from "./userQuestionController.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useChatStore } from "../../stores/chatStore.js";
import { pendingQuestionSnapshot, useUserQuestionStore } from "../../stores/userQuestionStore.js";

interface PendingQuestionRegionProps {
  onUserInitiatedResolved?: () => void;
}

function tryGetQuestionService(daemonUrl: string): IUserQuestionService | undefined {
  void daemonUrl;
  try {
    return getUserQuestionService();
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

function tryGetRunSnapshot(runId: string, signal: AbortSignal): Promise<unknown> {
  try {
    return getRunService().get(runId, false, signal);
  } catch {
    return Promise.reject(new Error("Run snapshot unavailable"));
  }
}

export function PendingQuestionRegion({ onUserInitiatedResolved }: PendingQuestionRegionProps) {
  const daemonUrl = useConnectionStore((state) => state.url);
  const sessionId = useConnectionStore((state) => state.sessionId);
  const connectionStatus = useConnectionStore((state) => state.status);
  const accessContext = getServiceAccessContext();
  const identityKey = accessContext.identityKey;
  const authToken = accessContext.authToken;
  const accessRevision = accessContext.accessRevision;
  const service = React.useMemo(() => tryGetQuestionService(daemonUrl), [daemonUrl]);
  const chatService = React.useMemo(() => tryGetChatService(daemonUrl), [daemonUrl]);
  const store = useUserQuestionStore();
  const [draft, setDraft] = React.useState("");
  const [focusQuestionId, setFocusQuestionId] = React.useState<string>();
  const controller = React.useMemo(
    () =>
      service
        ? new UserQuestionController({
            service,
            getHistory: chatService?.getHistory
              ? (activeSessionId, signal) => {
                  if (signal.aborted) {
                    return Promise.reject(new DOMException("Aborted", "AbortError"));
                  }
                  return chatService.getHistory(activeSessionId).then((history) => {
                    if (signal.aborted) {
                      throw new DOMException("Aborted", "AbortError");
                    }
                    return history;
                  });
                }
              : undefined,
            getRunSnapshot: tryGetRunSnapshot,
            onHistorySnapshot: (history) => {
              useChatStore.getState().replaceMessages(history.messages);
            },
          })
        : undefined,
    [chatService, service]
  );

  React.useEffect(() => {
    if (!controller) return;
    controller.setContext(
      sessionId && service
        ? {
            daemonUrl,
            sessionId,
            ...(identityKey ? { identityKey } : {}),
            ...(accessRevision !== undefined ? { accessRevision } : {}),
          }
        : undefined
    );
    controller.onConnectionStatus(connectionStatus);
    return () => {
      if (!sessionId || !service) controller.setContext(undefined);
    };
  }, [connectionStatus, controller, daemonUrl, identityKey, accessRevision, service, sessionId]);

  const accessChangeKey = `${accessRevision ?? 0}:${identityKey ?? ""}:${authToken ?? ""}`;
  const previousAccessChangeKey = React.useRef(accessChangeKey);
  React.useEffect(() => {
    if (!chatService || previousAccessChangeKey.current === accessChangeKey) return;
    previousAccessChangeKey.current = accessChangeKey;
    chatService.disconnect();
    if (!identityKey && !authToken) return;
    let cancelled = false;
    void chatService
      .connect()
      .then((connection) => {
        if (cancelled) return;
        const connectionState = useConnectionStore.getState();
        connectionState.setSessionId(connection.session_id);
        connectionState.setStatus("connected", connection.version);
      })
      .catch(() => {
        if (!cancelled) useConnectionStore.getState().setStatus("disconnected");
      });
    return () => {
      cancelled = true;
    };
  }, [accessChangeKey, authToken, chatService, identityKey]);

  React.useEffect(() => {
    if (!controller || !chatService) return;
    const unsubscribers: Array<() => void> = [];
    if (chatService.subscribeUserQuestion) {
      unsubscribers.push(
        chatService.subscribeUserQuestion((event) => {
          const current = useUserQuestionStore.getState().snapshots[event.payload.question_id];
          if (!current) setFocusQuestionId(event.payload.question_id);
          controller.onQuestionHint(event);
        })
      );
    }
    if (chatService.onQuestionProtocolError) {
      unsubscribers.push(chatService.onQuestionProtocolError(() => controller.onQuestionHint()));
    }
    if (chatService.onRunReconnect) {
      unsubscribers.push(chatService.onRunReconnect(() => void controller.refresh()));
    }
    if (chatService.subscribeRunCorrelation) {
      unsubscribers.push(
        chatService.subscribeRunCorrelation((event) => {
          if (event.event === "run.finished" || event.event === "run.completed") {
            controller.onRunFinished(event.run_id);
          }
        })
      );
    }
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [chatService, controller]);

  React.useEffect(() => {
    return () => controller?.dispose();
  }, [controller]);

  const question = pendingQuestionSnapshot(store);
  const questionId = question?.question_id;
  const questionState = question?.state;
  const previousQuestionId = React.useRef<string | undefined>(undefined);
  const focusAfterQuestionId = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    const previous = previousQuestionId.current;
    if (
      questionId === undefined &&
      previous !== undefined &&
      focusAfterQuestionId.current === previous
    ) {
      focusAfterQuestionId.current = undefined;
      onUserInitiatedResolved?.();
    }
  }, [onUserInitiatedResolved, questionId]);
  React.useEffect(() => {
    if (
      questionId !== previousQuestionId.current ||
      questionState !== "pending"
    ) {
      setDraft("");
    }
    previousQuestionId.current = questionId;
  }, [questionId, questionState]);
  React.useEffect(() => {
    if (
      focusQuestionId !== undefined &&
      questionId !== undefined &&
      questionId !== focusQuestionId
    ) {
      setFocusQuestionId(undefined);
    }
  }, [focusQuestionId, questionId]);
  const shouldFocusQuestion = focusQuestionId !== undefined && focusQuestionId === questionId;
  React.useEffect(() => {
    if (shouldFocusQuestion) setFocusQuestionId(undefined);
  }, [shouldFocusQuestion]);

  if (!controller || !question) return null;
  const controlsDisabled = store.status !== "ready" || store.mutationQuestionId !== undefined;
  const mutationAvailable = controller.canMutate(question.question_id);
  const status =
    !question.request || !mutationAvailable
      ? controller.isAccepted(question.question_id) ||
        question.state === "answered" ||
        question.state === "continuing"
        ? "Response accepted; agent is resuming…"
        : "Waiting for authorized input."
      : store.status === "offline"
      ? "Reconnecting; checking current question state"
      : store.status === "reconciling" || store.status === "loading"
        ? "Checking current question state…"
        : store.status === "submitting"
          ? "Submitting…"
          : undefined;

  return (
    <div
      className="mx-4 my-3"
      data-testid="pending-question-region"
      data-question-state={question.state}
    >
      {question.request ? (
        <UserQuestionCard
          key={question.question_id}
          question={question.request}
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={(value) => {
            const questionId = question.question_id;
            // Clear the answer before awaiting the server so a 202, conflict,
            // reconnect, or unmount cannot leave plaintext in the card state.
            setDraft("");
            focusAfterQuestionId.current = questionId;
            void controller.resolve(questionId, value).then((committed) => {
              if (committed) return;
              const current = useUserQuestionStore.getState().snapshots[questionId];
              if (!controller.isAccepted(questionId) &&
                  current?.state !== "answered" &&
                  current?.state !== "continuing") {
                focusAfterQuestionId.current = undefined;
              }
            });
          }}
          onCancel={() => {
            const questionId = question.question_id;
            setDraft("");
            focusAfterQuestionId.current = questionId;
            void controller.cancel(questionId).then((committed) => {
              if (committed) return;
              const current = useUserQuestionStore.getState().snapshots[questionId];
              if (!controller.isAccepted(questionId) &&
                  current?.state !== "answered" &&
                  current?.state !== "continuing") {
                focusAfterQuestionId.current = undefined;
              }
            });
          }}
          disabled={controlsDisabled || !mutationAvailable}
          submitting={store.mutationQuestionId === question.question_id}
          error={store.error}
          status={status}
          focus={shouldFocusQuestion}
        />
      ) : (
        <p role="status" aria-live="polite" className="rounded-md border border-border p-3 text-sm">
          {controller.isAccepted(question.question_id) ||
          question.state === "answered" ||
          question.state === "continuing"
            ? "Response accepted; agent is resuming the question."
            : "Agent question pending. Input is unavailable until authorized question details arrive."}
        </p>
      )}
    </div>
  );
}

PendingQuestionRegion.displayName = "PendingQuestionRegion";
