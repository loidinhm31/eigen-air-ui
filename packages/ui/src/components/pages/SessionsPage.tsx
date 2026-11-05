import * as React from "react";
import { useEffect, useState } from "react";
import { getSessionService } from "../../adapters/factory/ServiceFactory.js";
import { useBasePathNavigation } from "../../embed/base-path-navigation.js";
import { useChatStore } from "../../stores/chatStore.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useChatDebugStore } from "../../stores/chat-debug-store.js";
import { Button } from "../atoms/Button.js";
import { NativeScrollArea } from "../atoms/NativeScrollArea.js";
import { Spinner } from "../atoms/Spinner.js";
import { Badge } from "../atoms/Badge.js";
import type { Session, ExecutionTargetInput } from "@eigen-air-ui/shared/types";
import { resolveAuthoritativeModelDigest } from "@eigen-air-ui/shared/types";
import { ExecutionTargetSelector } from "../molecules/ExecutionTargetSelector.js";

export function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = React.useRef(0);
  const loadingMoreCursorRef = React.useRef<string | null>(null);
  const { sessionId, setSessionId, status: connectionStatus } = useConnectionStore();
  const clearMessages = useChatStore((state) => state.clearMessages);
  const { navigate } = useBasePathNavigation();
  const [targetInput, setTargetInput] = useState<ExecutionTargetInput>({ kind: "server" });
  const [showTargetSelector, setShowTargetSelector] = useState(false);

  async function loadFirstPage() {
    const generation = ++generationRef.current;
    loadingMoreCursorRef.current = null;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    try {
      const response = await getSessionService().listSessions({ limit: 50 });
      if (generation !== generationRef.current || !response) return;
      setSessions(response.sessions ?? []);
      setNextCursor(response.next_cursor ?? null);
    } catch (e) {
      if (generation !== generationRef.current) return;
      setSessions([]);
      setNextCursor(null);
      setError(String(e));
    } finally {
      if (generation === generationRef.current) {
        setLoading(false);
      }
    }
  }

  async function loadMore() {
    if (!nextCursor || loading || loadingMore) return;
    const cursor = nextCursor;
    if (loadingMoreCursorRef.current === cursor) return;
    const generation = generationRef.current;
    loadingMoreCursorRef.current = cursor;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await getSessionService().listSessions({ limit: 50, cursor });
      if (generation !== generationRef.current) return;
      setSessions((current) => {
        const existingIds = new Set(current.map((s) => s.id));
        const merged = [...current];
        for (const s of response.sessions) {
          if (!existingIds.has(s.id)) {
            existingIds.add(s.id);
            merged.push(s);
          }
        }
        return merged;
      });
      setNextCursor(response.next_cursor ?? null);
    } catch (e) {
      if (generation !== generationRef.current) return;
      setError(String(e));
    } finally {
      if (generation === generationRef.current) {
        setLoadingMore(false);
        loadingMoreCursorRef.current = null;
      }
    }
  }

  async function handleCreate(target?: ExecutionTargetInput) {
    setLoading(true);
    setError(null);
    try {
      const effective = target ?? targetInput;
      const finalTarget: ExecutionTargetInput | undefined =
        effective?.kind === "pool" && !effective.model_digest
          ? {
              ...effective,
              model_digest: resolveAuthoritativeModelDigest(effective.model_artifact_id),
            }
          : effective;
      const session = await getSessionService().createSession(finalTarget);
      setSessionId(session.id);
      clearMessages();
      navigate("/");
      await loadFirstPage();
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }

  function handleOpen(id: string) {
    setError(null);
    setSessionId(id);
    navigate("/");
  }

  async function handleDelete(id: string) {
    setLoading(true);
    setError(null);
    try {
      const deleted = await getSessionService().deleteSession(id);
      if (deleted) {
        useChatDebugStore.getState().evictSession(id);
        if (id === sessionId) {
          const replacement = await getSessionService().createSession();
          setSessionId(replacement.id);
          clearMessages();
          return;
        }
      }
      await loadFirstPage();
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }

  useEffect(() => {
    if (connectionStatus === "connected") {
      void loadFirstPage();
    } else if (connectionStatus === "connecting") {
      setLoading(true);
      setError(null);
    }
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generationRef.current++;
    };
  }, [sessionId, connectionStatus]);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Sessions</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadFirstPage()} disabled={loadingMore}>
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowTargetSelector((prev) => !prev)}
              disabled={loading}
            >
              Target Options
            </Button>
            <Button size="sm" onClick={() => void handleCreate()} disabled={loading}>
              New
            </Button>
          </div>
        </div>
        {showTargetSelector && (
          <div className="rounded-md border border-border/70 bg-muted/20 p-3">
            <ExecutionTargetSelector
              value={targetInput}
              onChange={setTargetInput}
              disabled={loading}
            />
          </div>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {loading && (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      )}
      <NativeScrollArea className="flex-1 pr-1">
        <div className="flex flex-col gap-2">
          {sessions.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground text-center py-8">No sessions</p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              data-testid={`session-${s.id}`}
              className="flex flex-col gap-2 rounded-md border border-border bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.title?.trim() || s.id}</p>
                <p className="font-mono text-xs text-muted-foreground truncate">{s.id}</p>
                <p className="text-xs text-muted-foreground">
                  {s.channel} · {s.status} · {new Date(s.updated_at * 1000).toLocaleString()}
                  {(s.inference_target ?? s.execution_target) && (
                    <span className="ml-2 font-medium text-foreground">
                      {(() => {
                        const t = s.inference_target ?? s.execution_target;
                        if (t?.kind === "pool") return `[Pool: ${t.pool_id} · ${t.model_artifact_id}]`;
                        if (t?.kind === "client_device") return `[Legacy Device: ${t.device_id.slice(0, 8)} (Migration Required)]`;
                        return "[Server]";
                      })()}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:ml-2">
                {s.id === sessionId && <Badge variant="primary">active</Badge>}
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  onClick={() => navigate(`/runs?session_id=${encodeURIComponent(s.id)}`)}
                  disabled={loading}
                  aria-label={`View runs for session ${s.id}`}
                >
                  View Runs
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpen(s.id)}
                  disabled={loading}
                >
                  Open
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDelete(s.id)}
                  disabled={loading}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
          {nextCursor && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                className="w-full min-h-11"
                onClick={() => void loadMore()}
                disabled={loading || loadingMore}
                isLoading={loadingMore}
              >
                Load more sessions
              </Button>
            </div>
          )}
        </div>
      </NativeScrollArea>
    </div>
  );
}
SessionsPage.displayName = "SessionsPage";
