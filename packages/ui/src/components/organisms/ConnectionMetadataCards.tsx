import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../atoms/Card.js";
import type { ServerConfig, AgentStatusResponse } from "@nonclaw-ui/shared/types";

export interface ConnectionMetadataCardsProps {
  agentStatus: AgentStatusResponse | null;
  config: ServerConfig | null;
}

function formatUptime(secs: unknown): string {
  if (typeof secs !== "number" || Number.isNaN(secs) || secs < 0) return "—";
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function formatValue(val: unknown): string {
  if (val === undefined || val === null || val === "" || (typeof val === "number" && Number.isNaN(val))) return "—";
  return String(val);
}

export function ConnectionMetadataCards({ agentStatus, config }: ConnectionMetadataCardsProps) {
  if (!agentStatus && !config) return null;

  return (
    <>
      {agentStatus && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Agent Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <span className="text-muted-foreground">Status</span>
              <span className="capitalize">{formatValue(agentStatus.status)}</span>
              <span className="text-muted-foreground">Model</span>
              <span className="font-mono">{formatValue(agentStatus.model)}</span>
              <span className="text-muted-foreground">Uptime</span>
              <span>{formatUptime(agentStatus.uptime_secs)}</span>
              <span className="text-muted-foreground">Memories</span>
              <span>{formatValue(agentStatus.memory_count)}</span>
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
    </>
  );
}
ConnectionMetadataCards.displayName = "ConnectionMetadataCards";
