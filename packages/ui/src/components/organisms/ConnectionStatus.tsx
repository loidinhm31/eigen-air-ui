import * as React from "react";
import { useState } from "react";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { getChatService, getConfigService, reinitServices } from "../../adapters/factory/ServiceFactory.js";
import { Input } from "../atoms/Input.js";
import { Button } from "../atoms/Button.js";
import { Badge } from "../atoms/Badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "../atoms/Card.js";
import type { ServerConfig, AgentStatusResponse } from "@nonclaw-ui/shared/types";

export function ConnectionStatus() {
  const { url, status, version, sessionId, setUrl, setStatus, setSessionId } =
    useConnectionStore();
  const [draftUrl, setDraftUrl] = useState(url);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatusResponse | null>(null);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    setStatus("connecting");
    setUrl(draftUrl);
    // Re-create all adapters pointing at the (possibly new) URL before any call.
    reinitServices();

    try {
      await getConfigService().health();
      const [cfg, aStatus, connectRes] = await Promise.all([
        getConfigService().getConfig(),
        getConfigService().getStatus(),
        getChatService().connect(),
      ]);
      setConfig(cfg);
      setAgentStatus(aStatus);
      setStatus("connected", connectRes.version);
      setSessionId(connectRes.session_id);
    } catch (e) {
      setStatus("disconnected");
      setError(String(e));
    } finally {
      setConnecting(false);
    }
  }

  const statusVariant =
    status === "connected" ? "success" : status === "connecting" ? "warning" : "destructive";

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center justify-between">
            Daemon Connection
            <Badge variant={statusVariant} className="capitalize">
              {status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder="http://localhost:18790"
              className="flex-1 font-mono text-sm"
            />
            <Button
              onClick={() => void handleConnect()}
              disabled={connecting}
              isLoading={connecting}
            >
              Connect
            </Button>
          </div>

          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          {status === "connected" && (
            <div className="space-y-1 text-xs text-muted-foreground">
              {version && <p>Version: <span className="text-foreground font-mono">{version}</span></p>}
              {sessionId && <p>Session: <span className="text-foreground font-mono truncate block">{sessionId}</span></p>}
            </div>
          )}
        </CardContent>
      </Card>

      {agentStatus && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Agent Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <span className="text-muted-foreground">Status</span>
              <span className="capitalize">{agentStatus.status}</span>
              <span className="text-muted-foreground">Model</span>
              <span className="font-mono">{agentStatus.model}</span>
              <span className="text-muted-foreground">Uptime</span>
              <span>{Math.floor(agentStatus.uptime_secs / 60)}m {agentStatus.uptime_secs % 60}s</span>
              <span className="text-muted-foreground">Memories</span>
              <span>{agentStatus.memory_count}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {config && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Config</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs overflow-x-auto text-muted-foreground">
              {JSON.stringify(config, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
ConnectionStatus.displayName = "ConnectionStatus";
