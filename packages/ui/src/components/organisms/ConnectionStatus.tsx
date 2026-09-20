import * as React from "react";
import { useState } from "react";
import { useConnectionStore } from "../../stores/connectionStore.js";
import {
  getChatService,
  getConfigService,
  reinitServices,
  setServiceAccessContext,
} from "../../adapters/factory/ServiceFactory.js";
import {
  getStoredAuthToken,
  getStoredTokenRetention,
  saveStoredAuthToken,
  clearStoredAuthToken,
} from "../../adapters/factory/tokenStorage.js";
import type { TokenRetention } from "@nonclaw-ui/shared/constants";
import { Input } from "../atoms/Input.js";
import { Button } from "../atoms/Button.js";
import { Badge } from "../atoms/Badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "../atoms/Card.js";
import type { ServerConfig, AgentStatusResponse } from "@nonclaw-ui/shared/types";
import { ConnectionMetadataCards } from "./ConnectionMetadataCards.js";

export interface ConnectionStatusProps {
  managedAccess?: boolean;
}

function toSafeErrorMessage(err: unknown): string {
  if (err instanceof Error || typeof err === "object") {
    const msg = err instanceof Error ? err.message : String(err);
    if (/unauthorized|401/i.test(msg)) {
      return "Authentication failed (401 Unauthorized)";
    }
    if (/forbidden|403/i.test(msg)) {
      return "Access forbidden (403 Forbidden)";
    }
    if (/not found|404/i.test(msg)) {
      return "Daemon endpoint not found (404)";
    }
    if (/failed to fetch|networkerror|econnrefused/i.test(msg)) {
      return "Network error: Unable to connect to daemon";
    }
    const sanitized = msg.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]");
    return sanitized.length > 100 ? `${sanitized.slice(0, 100)}...` : sanitized;
  }
  return "Connection failed";
}

export function ConnectionStatus({ managedAccess = false }: ConnectionStatusProps) {
  const { url, status, version, sessionId, setUrl, setStatus, setSessionId } =
    useConnectionStore();
  const [draftUrl, setDraftUrl] = useState(url);
  const [draftToken, setDraftToken] = useState(() => (!managedAccess ? getStoredAuthToken() ?? "" : ""));
  const [retention, setRetention] = useState<TokenRetention>(() => getStoredTokenRetention());
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatusResponse | null>(null);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    setStatus("connecting");
    setUrl(draftUrl);

    if (!managedAccess) {
      const trimmed = draftToken.trim();
      if (trimmed) {
        saveStoredAuthToken(trimmed, retention);
        setServiceAccessContext({ authToken: trimmed });
      } else {
        clearStoredAuthToken();
        setServiceAccessContext({});
      }
    }

    // Re-create all adapters pointing at the (possibly new) URL / access context before any call.
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
      try {
        getChatService().disconnect();
      } catch {
        // Ignore disconnect failure during error recovery
      }
      setConfig(null);
      setAgentStatus(null);
      setStatus("disconnected");
      setError(toSafeErrorMessage(e));
    } finally {
      setConnecting(false);
    }
  }

  function handleClear() {
    if (managedAccess) return;
    setDraftToken("");
    clearStoredAuthToken();
    setServiceAccessContext({});
    reinitServices();
    try {
      getChatService().disconnect();
    } catch {
      // Ignore disconnect failure during clear
    }
    setConfig(null);
    setAgentStatus(null);
    setError(null);
    setSessionId(undefined);
    setStatus("disconnected");
  }

  const statusVariant =
    status === "connected" ? "success" : status === "connecting" ? "warning" : "destructive";

  const retentionHelperText =
    retention === "session"
      ? "Token is preserved for the current browser session."
      : retention === "forever"
      ? "Token is preserved locally until explicitly cleared."
      : `Token is preserved locally with a ${
          retention === "1h"
            ? "1-hour"
            : retention === "24h"
            ? "24-hour"
            : retention === "7d"
            ? "7-day"
            : "30-day"
        } retention period.`;

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
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Daemon URL</label>
            <Input
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder="http://localhost:18790"
              className="font-mono text-sm"
            />
          </div>

          {managedAccess ? (
            <div className="space-y-1 rounded-md border border-border/70 bg-muted/30 px-3 py-2">
              <p className="text-xs font-medium">Authentication</p>
              <p className="text-xs text-muted-foreground">
                Authentication is managed by the host application.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Bearer Token (optional)</label>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">Retention:</span>
                  <select
                    value={retention}
                    onChange={(e) => setRetention(e.target.value as TokenRetention)}
                    className="h-6 rounded border border-input bg-transparent px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label="Token retention duration"
                  >
                    <option value="7d">7 days</option>
                    <option value="24h">24 hours</option>
                    <option value="30d">30 days</option>
                    <option value="1h">1 hour</option>
                    <option value="session">Session only</option>
                    <option value="forever">Until cleared</option>
                  </select>
                </div>
              </div>
              <Input
                type="password"
                autoComplete="off"
                value={draftToken}
                onChange={(e) => setDraftToken(e.target.value)}
                placeholder="Bearer token"
                className="font-mono text-sm"
              />
              <p className="text-[11px] text-muted-foreground">{retentionHelperText}</p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              onClick={() => void handleConnect()}
              disabled={connecting}
              isLoading={connecting}
              className="flex-1"
            >
              Connect
            </Button>
            {!managedAccess && (
              <Button
                variant="outline"
                onClick={handleClear}
                disabled={connecting}
              >
                Clear
              </Button>
            )}
          </div>

          {error && (
            <p className="text-xs text-destructive" role="alert">{error}</p>
          )}

          {status === "connected" && (
            <div className="space-y-1 text-xs text-muted-foreground">
              {version && <p>Version: <span className="text-foreground font-mono">{version}</span></p>}
              {sessionId && <p>Session: <span className="text-foreground font-mono truncate block">{sessionId}</span></p>}
            </div>
          )}
        </CardContent>
      </Card>

      <ConnectionMetadataCards agentStatus={agentStatus} config={config} />
    </div>
  );
}
ConnectionStatus.displayName = "ConnectionStatus";
