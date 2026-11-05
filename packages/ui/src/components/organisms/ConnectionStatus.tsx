import * as React from "react";
import { useState } from "react";
import { useConnectionStore } from "../../stores/connectionStore.js";
import {
  getConfigService,
  reinitServices,
  setServiceAccessContext,
} from "../../adapters/factory/ServiceFactory.js";
import {
  connectChat,
  disconnectChat,
  ConnectSupersededError,
} from "../../adapters/factory/connection-controller.js";
import {
  getStoredAuthToken,
  getStoredTokenRetention,
  saveStoredAuthToken,
  clearStoredAuthToken,
} from "../../adapters/factory/tokenStorage.js";
import type { TokenRetention } from "@eigen-air-ui/shared/constants";
import { Input } from "../atoms/Input.js";
import { Button } from "../atoms/Button.js";
import { Badge } from "../atoms/Badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "../atoms/Card.js";
import type { ServerConfig, AgentStatusResponse } from "@eigen-air-ui/shared/types";
import { getConnectionErrorMessage } from "../molecules/connection-error-notice.js";
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
  const { url, status, version, sessionId, setUrl, setSessionId, error: storeError } =
    useConnectionStore();
  const [draftUrl, setDraftUrl] = useState(url);
  const [draftToken, setDraftToken] = useState(() => (!managedAccess ? getStoredAuthToken() ?? "" : ""));
  const [retention, setRetention] = useState<TokenRetention>(() => getStoredTokenRetention());
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatusResponse | null>(null);
  const displayedError = error ?? getConnectionErrorMessage(storeError);
  async function handleConnect() {
    setConnecting(true);
    setError(null);

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, 10_000);

    try {
      const connecting = connectChat({
        intent: "manual",
        beforeConnect: () => {
          setUrl(draftUrl);
          if (!managedAccess) {
            const trimmed = draftToken.trim();
            if (trimmed) {
              saveStoredAuthToken(trimmed, retention);
              setServiceAccessContext({
                authToken: trimmed,
                capabilities: new Set(["run:read:debug", "run:export", "run:delete"]),
              });
            } else {
              clearStoredAuthToken();
              setServiceAccessContext({});
            }
          }
          // Re-create all adapters pointing at the (possibly new) URL / access context before any call.
          reinitServices();
        },
      });

      const [cfg, aStatus] = await Promise.all([
        getConfigService().getConfig(abortController.signal),
        getConfigService().getStatus(abortController.signal),
        connecting,
      ]);

      setConfig(cfg);
      setAgentStatus(aStatus);
    } catch (e) {
      if (e instanceof ConnectSupersededError) {
        return;
      }
      setConfig(null);
      setAgentStatus(null);
      setError(toSafeErrorMessage(e));
    } finally {
      abortController.abort();
      clearTimeout(timeoutId);
      setConnecting(false);
    }
  }

  function handleClear() {
    if (managedAccess) return;
    setDraftToken("");
    clearStoredAuthToken();
    setServiceAccessContext({});
    reinitServices();
    disconnectChat();
    setConfig(null);
    setAgentStatus(null);
    setError(null);
    setSessionId(undefined);
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
                    className="h-6 rounded border border-input bg-card px-1.5 text-xs text-foreground scheme-dark focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label="Token retention duration"
                  >
                    <option value="7d" className="bg-card text-foreground">7 days</option>
                    <option value="24h" className="bg-card text-foreground">24 hours</option>
                    <option value="30d" className="bg-card text-foreground">30 days</option>
                    <option value="1h" className="bg-card text-foreground">1 hour</option>
                    <option value="session" className="bg-card text-foreground">Session only</option>
                    <option value="forever" className="bg-card text-foreground">Until cleared</option>
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

          {displayedError && (
            <p className="text-xs text-destructive" role="alert">{displayedError}</p>
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
