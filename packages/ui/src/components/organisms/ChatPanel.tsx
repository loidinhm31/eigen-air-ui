import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Activity, Check, Copy, RotateCw } from "lucide-react";
import {
  getChatService,
  getRunService,
  getSessionService,
  getSkillService,
  getServiceAccessContext,
} from "../../adapters/factory/ServiceFactory.js";
import { useChatStore } from "../../stores/chatStore.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useDebugSettingsStore } from "../../stores/debugSettingsStore.js";
import { useMemoryStore } from "../../stores/memoryStore.js";
import { useChatDebugStore } from "../../stores/chat-debug-store.js";
import { extractModelFromSnapshot } from "../../adapters/http/chat-debug-projection.js";
import { Button } from "../atoms/Button.js";
import { Input } from "../atoms/Input.js";
import { ScrollArea } from "../atoms/ScrollArea.js";
import { Spinner } from "../atoms/Spinner.js";
import { ChatBubble } from "../molecules/ChatBubble.js";
import { CommandPalette } from "../molecules/CommandPalette.js";
import type { PaletteSelection } from "../molecules/commandPaletteModel.js";
import { ToolCallCard } from "../molecules/ToolCallCard.js";
import { PendingQuestionRegion } from "./PendingQuestionRegion.js";
import { PendingToolApprovalRegion } from "./PendingToolApprovalRegion.js";
import { useUserQuestionStore } from "../../stores/userQuestionStore.js";
import { useToolApprovalStore } from "../../stores/toolApprovalStore.js";
import { useReadinessStore } from "../../stores/readinessStore.js";
import { ModelReadinessBanner } from "../molecules/ModelReadinessBanner.js";
import { buildDebugTrace, copyDebugTrace } from "@eigen-air-ui/shared/utils";
import { useBasePathNavigation } from "../../embed/base-path-navigation.js";
import type {
  ChatDebugData,
  Skill,
  ToolCallPayload,
  ToolResultPayload,
  WsEvent,
} from "@eigen-air-ui/shared/types";

const PROVIDER_WAIT_STATUS = "Waiting for agent response...";
const TOOL_LIMIT_CONTINUE_PROMPT =
  "Continue from the previous tool results and finish the answer. Use tools only if necessary.";

export function ChatPanel() {
  const [input, setInput] = useState("");
  const {
    messages,
    isStreaming,
    streamingContent,
    streamStatus,
    streamError,
    addMessage,
    removeMessage,
    replaceMessages,
    beginStream,
    appendChunk,
    setStreamStatus,
    finalizeStream,
    finishStream,
    setStreamError,
    clearMessages,
  } = useChatStore();
  const { navigate } = (() => {
    try {
      return useBasePathNavigation();
    } catch {
      return { navigate: () => undefined };
    }
  })();
  const sessionId = useConnectionStore((state) => state.sessionId);
  const connectionStatus = useConnectionStore((state) => state.status);
  const questionBlocksComposer = useUserQuestionStore(
    (state) => state.composerBlockedSessionId === sessionId
  );
  const approvalBlocksComposer = useToolApprovalStore(
    (state) => state.composerBlockedSessionId === sessionId
  );
  const readinessPhase = useReadinessStore((state) => state.phase);
  const readinessSnapshot = useReadinessStore((state) => state.snapshot);
  const readinessError = useReadinessStore((state) => state.error);
  const canInfer = useReadinessStore((state) => state.canInfer);
  const retryReadiness = useReadinessStore((state) => state.retry);

  const isConnected = connectionStatus === "connected";
  const readinessBlocksComposer =
    !isConnected || !canInfer || (readinessPhase !== "ready" && readinessPhase !== "degraded_cpu");
  const composerBlocked =
    !isConnected || questionBlocksComposer || approvalBlocksComposer || readinessBlocksComposer;
  const composerPlaceholder =
    connectionStatus === "connecting"
      ? "Connecting to eigen-air..."
      : connectionStatus === "disconnected"
      ? "Connect to eigen-air to start..."
      : readinessPhase === "failed"
      ? "Model unavailable"
      : readinessBlocksComposer
      ? "Model is loading..."
      : "Message eigen-air...";
  const setSessionId = useConnectionStore((state) => state.setSessionId);
  const showPromptDebug = useDebugSettingsStore((state) => state.showPromptDebug);
  const showReasoningDebug = useDebugSettingsStore((state) => state.showReasoningDebug);
  const setShowPromptDebug = useDebugSettingsStore((state) => state.setShowPromptDebug);
  const setShowReasoningDebug = useDebugSettingsStore((state) => state.setShowReasoningDebug);
  const accessContext = getServiceAccessContext();
  const accessRevision = accessContext.accessRevision;
  const identityKey = accessContext.identityKey;
  const authToken = accessContext.authToken;
  const daemonUrl = useConnectionStore((state) => state.url);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);
  const streamingDebugRef = useRef<ChatDebugData | undefined>(undefined);
  const startupDebugAbortRef = useRef<AbortController | null>(null);
  const finalDebugAbortRef = useRef<AbortController | null>(null);
  const sendGenerationRef = useRef(0);
  const debugGenerationRef = useRef(0);
  const debugExpiryRef = useRef<{ at: number; timer: number } | null>(null);
  const inFlightSendRef = useRef(false);
  const [toolCalls, setToolCalls] = useState<Record<string, ToolCallPayload>>({});
  const [toolResults, setToolResults] = useState<Record<string, ToolResultPayload>>({});
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [limitContinuePrompt, setLimitContinuePrompt] = useState<string | null>(null);
  const [streamingDebug, setStreamingDebug] = useState<ChatDebugData | undefined>(undefined);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillLoadError, setSkillLoadError] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const errorCopyTimeoutRef = useRef<number | undefined>(undefined);
  const [copiedError, setCopiedError] = useState(false);
  const [ephemeralQuestionAnswer, setEphemeralQuestionAnswer] = useState<{
    questionId: string;
    answer: string;
    insertionIndex: number;
  }>();

  useEffect(() => {
    return () => {
      clearTimeout(debugExpiryRef.current?.timer);
      sendGenerationRef.current += 1;
      debugGenerationRef.current += 1;
      startupDebugAbortRef.current?.abort();
      finalDebugAbortRef.current?.abort();
    };
  }, []);

  const previousAccessRef = useRef<string | null>(null);
  useEffect(() => {
    const currentAccess = `${identityKey ?? ""}:${authToken ?? ""}:${daemonUrl}`;
    if (previousAccessRef.current !== null && previousAccessRef.current !== currentAccess) {
      clearCapturedDebug();
      useChatDebugStore.getState().invalidateAccess();
    }
    previousAccessRef.current = currentAccess;
  }, [identityKey, authToken, daemonUrl]);

  const previousSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (previousSessionRef.current !== null && previousSessionRef.current !== sessionId) {
      debugGenerationRef.current += 1;
      startupDebugAbortRef.current?.abort();
      finalDebugAbortRef.current?.abort();
      updateStreamingDebug(undefined);
    }
    previousSessionRef.current = sessionId ?? null;
  }, [sessionId]);

  useEffect(() => {
    if (!showPromptDebug && !showReasoningDebug) {
      clearCapturedDebug();
    }
  }, [showPromptDebug, showReasoningDebug]);

  function clearCapturedDebug() {
    debugGenerationRef.current += 1;
    startupDebugAbortRef.current?.abort();
    finalDebugAbortRef.current?.abort();
    updateStreamingDebug(undefined);
    useChatStore.setState((state) => ({
      messages: state.messages.map(({ debug: _debug, ...message }) => message),
    }));
    useChatDebugStore.getState().clearDebugCache();
    clearTimeout(debugExpiryRef.current?.timer);
    debugExpiryRef.current = null;
  }

  function retainDebugUntil(expiresAt: number) {
    if (!Number.isFinite(expiresAt)) return;
    if (debugExpiryRef.current && debugExpiryRef.current.at <= expiresAt) return;
    clearTimeout(debugExpiryRef.current?.timer);
    debugExpiryRef.current = {
      at: expiresAt,
      timer: window.setTimeout(clearCapturedDebug, Math.max(0, expiresAt - Date.now())),
    };
  }

  const handleCopyErrorTrace = async () => {
    const connection = useConnectionStore.getState();
    const userQuestion = useUserQuestionStore.getState();
    const trace = buildDebugTrace({
      sessionId,
      daemonUrl: connection.url,
      connectionStatus: connection.status,
      connectionVersion: connection.version,
      questionState: {
        status: userQuestion.status,
        error: userQuestion.error,
        activeQuestionId: userQuestion.mutationQuestionId,
      },
      streamState: {
        status: streamStatus,
        error: streamError,
      },
    });
    const success = await copyDebugTrace(trace);
    if (success) {
      setCopiedError(true);
      clearTimeout(errorCopyTimeoutRef.current);
      errorCopyTimeoutRef.current = window.setTimeout(() => setCopiedError(false), 2000);
    }
  };
  const bumpMemoryRevision = useMemoryStore((state) => state.bumpRevision);

  function getDebugOptions() {
    if (!showPromptDebug && !showReasoningDebug) {
      return undefined;
    }
    return {
      includePrompt: showPromptDebug,
      includeReasoning: showReasoningDebug,
    };
  }

  function updateStreamingDebug(
    next:
      | ChatDebugData
      | undefined
      | ((previous: ChatDebugData | undefined) => ChatDebugData | undefined)
  ) {
    const resolved = typeof next === "function" ? next(streamingDebugRef.current) : next;
    streamingDebugRef.current = resolved;
    setStreamingDebug(resolved);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  useEffect(() => {
    let cancelled = false;

    if (connectionStatus !== "connected") {
      setSkills([]);
      setSkillsLoading(true);
      setSkillLoadError(null);
      return;
    }

    setSkillsLoading(true);
    setSkillLoadError(null);
    Promise.resolve()
      .then(() => getSkillService().list())
      .then((availableSkills) => {
        if (cancelled) return;
        setSkills(availableSkills);
        setSkillsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSkills([]);
        setSkillsLoading(false);
        setSkillLoadError("Installed skills unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [connectionStatus]);

  useEffect(() => {
    startupDebugAbortRef.current?.abort();
    finalDebugAbortRef.current?.abort();
    setSelectedSkill(null);
    setPaletteOpen(false);
  }, [connectionStatus, sessionId]);
  useEffect(() => {
    setEphemeralQuestionAnswer(undefined);
  }, [connectionStatus, sessionId]);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      startupDebugAbortRef.current?.abort();
      finalDebugAbortRef.current?.abort();
      setToolCalls({});
      setToolResults({});
      setMemoryNotice(null);
      setLimitContinuePrompt(null);
      updateStreamingDebug(undefined);

      if (!sessionId) {
        clearMessages();
        return;
      }

      if (connectionStatus !== "connected") {
        return;
      }

      const historyLoadRevision = useChatStore.getState().messageRevision;
      for (let attempt = 0; attempt < 10 && !cancelled; attempt++) {
        try {
          const history = await getChatService().getHistory(sessionId, getDebugOptions());
          if (!cancelled && useChatStore.getState().messageRevision === historyLoadRevision) {
            replaceMessages(history.messages);
          }
          return;
        } catch (error) {
          if (String(error).includes("WS not connected") && attempt < 9) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
          }
          if (!cancelled && useChatStore.getState().messageRevision === historyLoadRevision) {
            replaceMessages([]);
            setStreamError(String(error));
          }
          return;
        }
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [
    clearMessages,
    connectionStatus,
    replaceMessages,
    sessionId,
    setStreamError,
  ]);

  async function sendPrompt(
    msg: string,
    allowToolLimitContinue = false,
    selectedSkillId?: string
  ): Promise<boolean> {
    if (!msg.trim() || isStreaming || composerBlocked) return false;
    setToolCalls({});
    setToolResults({});
    setMemoryNotice(null);
    setLimitContinuePrompt(null);
    updateStreamingDebug(undefined);
    const clientMsgId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    addMessage({ id: clientMsgId, role: "user", content: msg });
    beginStream("Submitting message...");
    let latestRunId: string | undefined;
    const chosenSkill = selectedSkillId
      ? skills.find((skill) => skill.id === selectedSkillId)
      : undefined;
    inFlightSendRef.current = true;
    const turnGeneration = ++sendGenerationRef.current;
    let finalRefreshDoneForThisTurn = false;
    const turnSessionId = sessionId;
    const turnAccess = getServiceAccessContext();
    const turnDaemonUrl = useConnectionStore.getState().url;
    const isCurrentTurn = () => {
      const connection = useConnectionStore.getState();
      const access = getServiceAccessContext();
      return sendGenerationRef.current === turnGeneration &&
        connection.sessionId === turnSessionId &&
        connection.url === turnDaemonUrl &&
        access.identityKey === turnAccess.identityKey &&
        access.authToken === turnAccess.authToken;
    };

    startupDebugAbortRef.current?.abort();
    startupDebugAbortRef.current = null;
    finalDebugAbortRef.current?.abort();
    finalDebugAbortRef.current = null;

    try {
      const debug = getDebugOptions();
      const result = await getChatService().sendMessage(
        msg,
        sessionId,
        (event: WsEvent) => {
          if (event.event === "run.started") {
            if (!inFlightSendRef.current) {
              return;
            }
            // Preserve canonical ID precedence: envelope event.run_id > existing latestRunId > event.payload.run_id
            const canonicalRunId = event.run_id ?? latestRunId ?? event.payload.run_id;
            latestRunId = canonicalRunId;
            updateStreamingDebug(event.payload.debug);
            beginStream(PROVIDER_WAIT_STATUS);

            const isDebugOptedIn =
              showPromptDebug || showReasoningDebug || Boolean(debug);

            if (isDebugOptedIn && canonicalRunId) {
              const startupAbortController = new AbortController();
              startupDebugAbortRef.current?.abort();
              startupDebugAbortRef.current = startupAbortController;
              const debugGeneration = debugGenerationRef.current;

              void (async () => {
                try {
                  const runSnapshot = await getRunService().get(canonicalRunId, {
                    includeDebug: true,
                    signal: startupAbortController.signal,
                  });
                  if (
                    startupAbortController.signal.aborted ||
                    debugGenerationRef.current !== debugGeneration ||
                    !isCurrentTurn() ||
                    !inFlightSendRef.current ||
                    finalRefreshDoneForThisTurn ||
                    latestRunId !== canonicalRunId ||
                    runSnapshot?.run.run_id !== canonicalRunId
                  ) return;
                  const currentDebugSettings = useDebugSettingsStore.getState();

                  if (runSnapshot) {
                    const now = Date.now();
                    retainDebugUntil(Math.min(...(runSnapshot.debug_excerpts ?? [])
                      .filter((excerpt) => excerpt.expires_at_ms > now)
                      .map((excerpt) => excerpt.expires_at_ms)));
                    const promptExcerpt = currentDebugSettings.showPromptDebug
                      ? runSnapshot.debug_excerpts?.find(
                          (e) => e.kind === "system_prompt" && e.expires_at_ms > now
                        )?.plaintext
                      : undefined;

                    const provider = runSnapshot.run?.provider_id || "default";
                    const model =
                      runSnapshot.run &&
                      "model" in runSnapshot.run &&
                      typeof runSnapshot.run.model === "string"
                        ? runSnapshot.run.model
                        : "default";

                    updateStreamingDebug((previous) => {
                      const latestSettings = useDebugSettingsStore.getState();
                      if (
                        !latestSettings.showPromptDebug &&
                        !latestSettings.showReasoningDebug
                      ) {
                        return undefined;
                      }
                      const current = previous ?? {
                        provider,
                        model,
                        active_skill: chosenSkill ? { name: chosenSkill.name, score: 1.0 } : undefined,
                      };
                      return {
                        ...current,
                        provider: provider !== "default" ? provider : current.provider,
                        model: model !== "default" ? model : current.model,
                        system_prompt: latestSettings.showPromptDebug
                          ? (promptExcerpt ?? current.system_prompt)
                          : undefined,
                        reasoning: latestSettings.showReasoningDebug
                          ? current.reasoning
                          : undefined,
                      };
                    });
                  }
                } catch {
                  // Startup snapshot fetch is best-effort; final snapshot fetch will run on completion
                }
              })();
            }
          } else if (event.event === "chunk") {
            appendChunk(event.payload.content);
          } else if (event.event === "run.delta") {
            appendChunk(event.payload.delta);
          } else if (event.event === "run.reasoning_delta") {
            updateStreamingDebug((previous) => {
              const current = previous ?? {
                provider: "default",
                model: "default",
                active_skill: chosenSkill ? { name: chosenSkill.name, score: 1.0 } : undefined,
              };
              return {
                ...current,
                reasoning: {
                  requested: true,
                  available: true,
                  text: `${current.reasoning?.text ?? ""}${event.payload.delta}`,
                },
              };
            });
          } else if (event.event === "run.completed" || event.event === "run.finished") {
            latestRunId = event.run_id ?? latestRunId ?? event.payload.run_id;
            updateStreamingDebug((previous) => {
              if (!event.payload.debug) return previous;
              return {
                ...previous,
                ...event.payload.debug,
                system_prompt: previous?.system_prompt ?? event.payload.debug.system_prompt,
                reasoning: previous?.reasoning ?? event.payload.debug.reasoning,
              };
            });
            if (!inFlightSendRef.current) {
              const streamedContent = useChatStore.getState().streamingContent;
              const content = event.payload.content || streamedContent;
              if (content.trim().length > 0) {
                finalizeStream({
                  role: "assistant",
                  content,
                  ...(latestRunId ? { id: `assistant-${latestRunId}` } : {}),
                  ...(latestRunId ? { run_id: latestRunId } : {}),
                  ...(streamingDebugRef.current ? { debug: streamingDebugRef.current } : {}),
                });
              } else {
                finishStream();
              }
              updateStreamingDebug(undefined);
              setEphemeralQuestionAnswer(undefined);
              bumpMemoryRevision();
            } else {
              setStreamStatus("Finalizing response...");
            }
            if (event.payload.can_continue) {
              setLimitContinuePrompt(TOOL_LIMIT_CONTINUE_PROMPT);
            }
          } else if (event.event === "tool.call" || event.event === "tool.started") {
            setToolCalls((calls) => ({ ...calls, [event.payload.id]: event.payload }));
            setStreamStatus(`Running ${event.payload.name}...`);
          } else if (event.event === "tool.result" || event.event === "tool.finished") {
            setToolResults((results) => ({ ...results, [event.payload.id]: event.payload }));
            setStreamStatus(PROVIDER_WAIT_STATUS);
          } else if (event.event === "error") {
            startupDebugAbortRef.current?.abort();
            updateStreamingDebug(undefined);
            setStreamError(event.payload.message);
          }
        },
        {
          ...(selectedSkillId !== undefined ? { selectedSkillId } : {}),
          ...(allowToolLimitContinue ? { allowToolLimitContinue: true } : {}),
          ...(debug ? { debug } : {}),
        }
      );

      finalRefreshDoneForThisTurn = true;
      (startupDebugAbortRef.current as AbortController | null)?.abort();


      const finalAbortController = new AbortController();
      finalDebugAbortRef.current = finalAbortController;

      const debugGeneration = debugGenerationRef.current;
      const canReadDebug = () => {
        const settings = useDebugSettingsStore.getState();
        return !finalAbortController.signal.aborted &&
          debugGenerationRef.current === debugGeneration &&
          isCurrentTurn() &&
          (settings.showPromptDebug || settings.showReasoningDebug);
      };
      let finalDebug: ChatDebugData | undefined;
      if (latestRunId && canReadDebug()) {
        try {
          const service = getRunService();
          const runSnapshot = await service.get(latestRunId, {
            includeDebug: true,
            signal: finalAbortController.signal,
          });
          if (canReadDebug() && runSnapshot?.run.run_id === latestRunId) {
            const debugExcerpts = [...(runSnapshot.debug_excerpts ?? [])];
            let debugCursor = runSnapshot.next_debug_cursor;
            const seenCursors = new Set<string>();
            // The server caps debug plaintext to 64 KiB per run. Bound paging too.
            for (let page = 1; debugCursor && page < 16 && canReadDebug(); page++) {
              if (seenCursors.has(debugCursor)) break;
              seenCursors.add(debugCursor);
              const next = await service.get(latestRunId, {
                includeDebug: true,
                debugCursor,
                signal: finalAbortController.signal,
              });
              if (!canReadDebug() || next.run.run_id !== latestRunId) break;
              debugExcerpts.push(...(next.debug_excerpts ?? []));
              debugCursor = next.next_debug_cursor;
            }
            if (canReadDebug()) {
              const settings = useDebugSettingsStore.getState();
              const now = Date.now();
              const unexpired = debugExcerpts.filter((excerpt) => excerpt.expires_at_ms > now);
              retainDebugUntil(Math.min(...unexpired.map((excerpt) => excerpt.expires_at_ms)));
              const reasoning = settings.showReasoningDebug
                ? [...new Map(unexpired.map((excerpt) => [excerpt.excerpt_seq, excerpt])).values()]
                    .filter((excerpt) => excerpt.kind === "provider_reasoning")
                    .sort((a, b) => a.excerpt_seq - b.excerpt_seq)
                    .map((excerpt) => excerpt.plaintext)
                    .join("\n\n")
                : "";
              finalDebug = {
                provider: runSnapshot.run.provider_id,
                model: extractModelFromSnapshot(runSnapshot) || "Not reported",
                system_prompt: settings.showPromptDebug
                  ? unexpired.find((excerpt) => excerpt.kind === "system_prompt")?.plaintext
                  : undefined,
                reasoning: settings.showReasoningDebug
                  ? { requested: true, available: Boolean(reasoning), text: reasoning || null }
                  : undefined,
              };
              if (sessionId) {
                useChatDebugStore.getState().seedFromSnapshot(runSnapshot, sessionId);
              }
            }
          }
        } catch {
          // Do not retain startup plaintext after a denied or expired final read.
        }
      } else if (!latestRunId && canReadDebug() && "content" in result) {
        const settings = useDebugSettingsStore.getState();
        finalDebug = result.debug ? {
          ...result.debug,
          system_prompt: settings.showPromptDebug ? result.debug.system_prompt : undefined,
          reasoning: settings.showReasoningDebug ? result.debug.reasoning : undefined,
        } : undefined;
      }
      if (!canReadDebug()) finalDebug = undefined;
      const isSameSession =
        sendGenerationRef.current === turnGeneration &&
        useConnectionStore.getState().sessionId === turnSessionId;
      if (!isSameSession) {
        finishStream();
        updateStreamingDebug(undefined);
        return false;
      }

      if (!("content" in result)) {
        const streamedContent = useChatStore.getState().streamingContent;
        if (streamedContent.trim().length > 0) {
          finalizeStream({
            role: "assistant",
            content: streamedContent,
            ...(latestRunId ? { id: `assistant-${latestRunId}` } : {}),
            ...(latestRunId ? { run_id: latestRunId } : {}),
            ...(finalDebug ? { debug: finalDebug } : {}),
          });
        } else {
          finishStream();
        }
        updateStreamingDebug(undefined);
        return true;
      }

      finalizeStream({
        role: "assistant",
        content: result.content,
        ...(result.message_id ? { id: result.message_id } : latestRunId ? { id: `assistant-${latestRunId}` } : {}),
        ...(latestRunId ? { run_id: latestRunId } : {}),
        ...(finalDebug ? { debug: finalDebug } : {}),
      });
      updateStreamingDebug(undefined);
      bumpMemoryRevision();
      if (result.can_continue) {
        setLimitContinuePrompt(TOOL_LIMIT_CONTINUE_PROMPT);
      }
      if (result.memory_updated) {
        setMemoryNotice(
          result.episode_id
            ? `Memory updated: episode saved, ${result.fact_count ?? 0} derived facts`
            : "Working memory updated"
        );
      } else if (result.can_continue) {
        setMemoryNotice("Agent needs another attempt. Use Continue.");
      } else if (result.tool_limit_reached) {
        setMemoryNotice("Tool limit reached");
      } else if (result.memory_reason === "sensitive_content") {
        setMemoryNotice("Memory not saved because the transcript may contain sensitive content");
      }
      return true;
    } catch (e) {
      (startupDebugAbortRef.current as AbortController | null)?.abort();
      finalDebugAbortRef.current?.abort();
      updateStreamingDebug(undefined);
      setStreamError(String(e));
      if (!latestRunId) {
        removeMessage(clientMsgId);
      }
      return false;
    } finally {
      inFlightSendRef.current = false;
      if (useChatStore.getState().isStreaming) {
        finishStream();
      }
    }
  }

  async function handleSend() {
    if (!input.trim() || isStreaming || composerBlocked) return;
    const msg = input.trim();
    const selectedSkillId = selectedSkill?.id;
    setInput("");
    setSelectedSkill(null);
    setPaletteOpen(false);
    const accepted = await sendPrompt(msg, false, selectedSkillId);
    if (!accepted) {
      setInput((current) => (current ? current : msg));
    }
  }

  function handlePaletteSelect(outcome: PaletteSelection) {
    if (outcome.kind === "command") {
      setSelectedSkill(null);
      setInput(outcome.command);
      return;
    }

    setSelectedSkill(outcome.skill);
  }

  async function handleContinueFromLimit() {
    if (!limitContinuePrompt || isStreaming || composerBlocked) return;
    setSelectedSkill(null);
    await sendPrompt(limitContinuePrompt, true);
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (composerBlocked) return;
    if (
      event.key === "/" &&
      input.length === 0 &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      setPaletteOpen(true);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      void handleSend();
    }
  }

  async function handleNewChat() {
    if (isStreaming || isStartingSession) return;
    setEphemeralQuestionAnswer(undefined);
    try {
      const session = await getSessionService().createSession();
      setSessionId(session.id);
      clearMessages();
      setToolCalls({});
      setToolResults({});
      setMemoryNotice(null);
      setLimitContinuePrompt(null);
      updateStreamingDebug(undefined);
      setSelectedSkill(null);
      setPaletteOpen(false);
      setInput("");
    } catch (e) {
      setStreamError(String(e));
    } finally {
      setIsStartingSession(false);
    }
  }
  const displayedMessages = ephemeralQuestionAnswer
    ? [
        ...messages.slice(0, Math.min(ephemeralQuestionAnswer.insertionIndex, messages.length)),
        {
          id: `question-answer-${ephemeralQuestionAnswer.questionId}`,
          role: "user" as const,
          content: ephemeralQuestionAnswer.answer,
        },
        ...messages.slice(Math.min(ephemeralQuestionAnswer.insertionIndex, messages.length)),
      ]
    : messages;

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <p className="text-sm font-medium">Chat</p>
            {sessionId && (
              <p className="text-muted-foreground truncate font-mono text-xs" title={sessionId}>
                Session: {sessionId}
              </p>
            )}
          </div>
          {sessionId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/runs?session_id=${sessionId}`)}
              className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
              title="View runs for this session"
            >
              <Activity size={13} className="mr-1" />
              Runs
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={showReasoningDebug || showPromptDebug ? "secondary" : "ghost"}
            size="sm"
            onClick={() => {
              const next = !(showReasoningDebug || showPromptDebug);
              setShowPromptDebug(next);
              setShowReasoningDebug(next);
            }}
            className="text-xs h-7 px-2"
            title="Toggle system prompt and reasoning debug surfaces"
          >
            Debug: {showReasoningDebug || showPromptDebug ? "On" : "Off"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleNewChat()}
            disabled={isStreaming || isStartingSession}
            isLoading={isStartingSession}
          >
            New chat
          </Button>
        </div>
      </div>
      <ScrollArea className="w-full min-w-0 flex-1">
        <div className="flex w-full min-w-0 flex-col overflow-x-hidden">
          {displayedMessages.map((msg, index) => (
            <ChatBubble key={msg.id ?? `${msg.role}-${index}`} message={msg} />
          ))}
          {Object.values(toolCalls).map((tc) => (
            <div key={tc.id} className="w-full min-w-0 max-w-full">
              <ToolCallCard call={tc} result={toolResults[tc.id]} />
            </div>
          ))}
          <PendingToolApprovalRegion />
          {isStreaming && (
            <ChatBubble
              message={{
                role: "assistant",
                content: streamingContent,
                ...(streamingDebug ? { debug: streamingDebug } : {}),
              }}
              isStreaming
              statusLabel={streamStatus ?? undefined}
            />
          )}
          <PendingQuestionRegion
            onUserInitiatedResolved={() => composerRef.current?.focus()}
            onAnswerSubmitted={(questionId, answer) => {
              setEphemeralQuestionAnswer({
                questionId,
                answer,
                insertionIndex: messages.length,
              });
            }}
            onAnswerRejected={(questionId) => {
              setEphemeralQuestionAnswer((current) =>
                current?.questionId === questionId ? undefined : current
              );
            }}
          />
          {streamError && (
            <div className="border-destructive/40 bg-destructive/10 text-destructive mx-4 my-2 flex items-center justify-between rounded-md border px-3 py-2 text-xs">
              <span className="truncate">{streamError}</span>
              <button
                type="button"
                onClick={() => void handleCopyErrorTrace()}
                className="border-destructive/30 bg-destructive/15 text-destructive hover:bg-destructive/25 focus-visible:outline-ring ml-2 inline-flex shrink-0 items-center gap-1 rounded border px-2 py-0.5 text-xs transition-colors focus-visible:outline focus-visible:outline-2"
                title="Copy all error and debug information to clipboard"
                aria-label="Copy error and debug information to clipboard"
              >
                {copiedError ? <Check size={12} /> : <Copy size={12} />}
                <span>{copiedError ? "Copied" : "Copy debug"}</span>
              </button>
            </div>
          )}
          {memoryNotice && (
            <div className="border-border bg-accent/40 text-muted-foreground mx-4 my-2 rounded-md border px-3 py-2 text-xs">
              {memoryNotice}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div className="border-border border-t p-3">
        <div className="mb-2">
          <ModelReadinessBanner
            phase={readinessPhase}
            snapshot={readinessSnapshot}
            error={readinessError}
            onRetry={retryReadiness}
          />
        </div>
        {selectedSkill && (
          <div className="mb-2 flex items-center gap-2" role="status">
            <span className="border-border bg-accent rounded-full border px-2.5 py-1 text-xs">
              Skill: {selectedSkill.name}
            </span>
            <button
              type="button"
              className="text-muted-foreground focus-visible:ring-ring text-xs underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2"
              aria-label={`Remove selected skill ${selectedSkill.name}`}
              onClick={() => {
                setSelectedSkill(null);
                composerRef.current?.focus();
              }}
            >
              Remove
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            skills={skills}
            loading={skillsLoading}
            error={skillLoadError}
            disabled={isStreaming || composerBlocked}
            onSelect={handlePaletteSelect}
            onRequestComposerFocus={() => composerRef.current?.focus()}
          />
          <Input
            ref={composerRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder={composerPlaceholder}
            disabled={isStreaming || composerBlocked}
            className="flex-1"
          />
          {isStreaming ? (
            <Button
              variant="outline"
              size="icon"
              onClick={() => getChatService().abort()}
              title="Abort"
            >
              <Spinner size="sm" />
            </Button>
          ) : (
            <>
              {limitContinuePrompt && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleContinueFromLimit()}
                  disabled={isStreaming || composerBlocked}
                >
                  <RotateCw className="mr-2 h-4 w-4" />
                  Continue
                </Button>
              )}
              <Button
                onClick={() => void handleSend()}
                disabled={!input.trim() || composerBlocked}
              >
                Send
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

ChatPanel.displayName = "ChatPanel";