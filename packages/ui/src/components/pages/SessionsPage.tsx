import * as React from "react";
import { useEffect, useState } from "react";
import { getChatService } from "../../adapters/factory/ServiceFactory.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { WS_METHODS } from "@nonclaw-ui/shared/constants";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";
import { ScrollArea } from "../atoms/ScrollArea.js";
import { Badge } from "../atoms/Badge.js";
import type { Session } from "@nonclaw-ui/shared/types";

export function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const { sessionId, setSessionId } = useConnectionStore();

  async function loadSessions() {
    setLoading(true);
    try {
      // Sessions are fetched via WS — use the chat service's underlying client indirectly
      // by calling the WsClient directly through getChatService() which wraps WsChatAdapter
      const history = await getChatService().getHistory();
      // Sessions list is not directly exposed via IChatService; show current session info
      setSessions(
        sessionId ? [{ id: sessionId, created_at: new Date().toISOString() }] : []
      );
    } catch {
      setSessions([]);
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
        <Button variant="outline" size="sm" onClick={() => void loadSessions()} disabled={loading}>
          Refresh
        </Button>
      </div>

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
                  {new Date(s.created_at).toLocaleString()}
                </p>
              </div>
              {s.id === sessionId && (
                <Badge variant="primary" className="ml-2 shrink-0">active</Badge>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
SessionsPage.displayName = "SessionsPage";
