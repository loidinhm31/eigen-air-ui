import * as React from "react";
import { useEffect, useState } from "react";
import { getSessionService } from "../../adapters/factory/ServiceFactory.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";
import { ScrollArea } from "../atoms/ScrollArea.js";
import { Badge } from "../atoms/Badge.js";
import type { Session } from "@nonclaw-ui/shared/types";

export function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { sessionId, setSessionId } = useConnectionStore();

  async function loadSessions() {
    setLoading(true);
    setError(null);
    try {
      setSessions(await getSessionService().listSessions());
    } catch (e) {
      setSessions([]);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      const session = await getSessionService().createSession();
      setSessionId(session.id);
      setSessions(await getSessionService().listSessions());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    setLoading(true);
    setError(null);
    try {
      const deleted = await getSessionService().deleteSession(id);
      if (deleted && id === sessionId) setSessionId(undefined);
      setSessions(await getSessionService().listSessions());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSessions();
  }, [sessionId]);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Sessions</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadSessions()} disabled={loading}>
            Refresh
          </Button>
          <Button size="sm" onClick={() => void handleCreate()} disabled={loading}>
            New
          </Button>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {loading && (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2">
          {sessions.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground text-center py-8">No sessions</p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <p className="font-mono text-xs truncate">{s.id}</p>
                <p className="text-xs text-muted-foreground">
                  {s.channel} · {s.status} · {new Date(s.updated_at * 1000).toLocaleString()}
                </p>
              </div>
              <div className="ml-2 flex shrink-0 items-center gap-2">
                {s.id === sessionId && <Badge variant="primary">active</Badge>}
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
        </div>
      </ScrollArea>
    </div>
  );
}
SessionsPage.displayName = "SessionsPage";
