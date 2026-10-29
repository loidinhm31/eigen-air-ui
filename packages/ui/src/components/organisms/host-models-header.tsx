import * as React from "react";
import type { HostView } from "@eigen-air-ui/shared/types";
import { Spinner } from "../atoms/Spinner.js";
import { Cpu, RefreshCw, Server } from "lucide-react";

export interface HostModelsHeaderProps {
  effectiveHostId: string;
  hostList: HostView[];
  loading: boolean;
  onHostChange: (newHostId: string) => void;
  onRefresh: () => void;
}

export function HostModelsHeader({
  effectiveHostId,
  hostList,
  loading,
  onHostChange,
  onRefresh,
}: HostModelsHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
      <div>
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Cpu className="h-5 w-5 text-primary" />
          Host Catalog Recommendations
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Measured qualification, fit verdicts, performance telemetry, and load dispatch.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <Server className="h-4 w-4 text-muted-foreground" />
          <select
            value={effectiveHostId}
            onChange={(e) => onHostChange(e.target.value)}
            className="min-h-[44px] rounded-md border border-input bg-background/80 px-3 py-1.5 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            data-testid="host-selector"
          >
            {hostList.length === 0 ? (
              <option value="">No hosts available</option>
            ) : (
              hostList.map((h) => (
                <option key={h.host_id} value={h.host_id}>
                  {h.label || h.host_id} ({h.platform})
                </option>
              ))
            )}
          </select>
        </div>

        {loading && <Spinner size="sm" />}
        <button
          type="button"
          disabled={!effectiveHostId}
          onClick={onRefresh}
          className="flex items-center gap-1.5 min-h-[44px] px-3 text-xs text-muted-foreground hover:text-foreground rounded-md border border-border/60 hover:bg-muted/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          data-testid="refresh-host-models-btn"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>
    </div>
  );
}
