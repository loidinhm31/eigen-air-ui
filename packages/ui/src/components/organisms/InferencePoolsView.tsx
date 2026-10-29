import * as React from "react";
import { useEffect } from "react";
import { useInferenceStore } from "../../stores/inferenceStore.js";
import { Badge } from "../atoms/Badge.js";
import { Spinner } from "../atoms/Spinner.js";
import { Layers, RefreshCw, Wifi, WifiOff } from "lucide-react";

export interface InferencePoolsViewProps {
  className?: string;
  onSelectHost?: (hostId: string) => void;
}

export function InferencePoolsView({ className = "", onSelectHost }: InferencePoolsViewProps) {
  const { pools, hosts, loadingPools, fetchPools, fetchHosts } = useInferenceStore();

  useEffect(() => {
    void fetchPools();
    void fetchHosts();
  }, [fetchPools, fetchHosts]);

  const poolList = Object.values(pools);
  const hostList = Object.values(hosts);

  return (
    <div className={`space-y-6 ${className}`} data-testid="inference-pools-view">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Inference Pools
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Managed dispatch target pools, node readiness counts, and member hosts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loadingPools && <Spinner size="sm" />}
          <button
            type="button"
            onClick={() => {
              void fetchPools();
              void fetchHosts();
            }}
            className="flex items-center gap-1.5 min-h-[44px] px-3 text-xs text-muted-foreground hover:text-foreground rounded-md border border-border/60 hover:bg-muted/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            data-testid="refresh-pools-button"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Pools List */}
      {poolList.length === 0 && !loadingPools ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
          No inference pools configured in the gateway.
        </div>
      ) : (
        <div className="grid gap-4">
          {poolList.map((pool) => {
            const boundHosts = hostList.filter(
              (h) => h.current_binding?.pool_id === pool.pool_id && h.current_binding?.state === "bound"
            );
            const drainingHosts = hostList.filter(
              (h) => h.current_binding?.pool_id === pool.pool_id && h.current_binding?.state === "draining"
            );

            return (
              <div
                key={pool.pool_id}
                className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-xs shadow-sm hover:border-border/90 transition-colors"
                data-testid={`pool-card-${pool.pool_id}`}
              >
                {/* Pool Header & Readiness Stats */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-foreground">{pool.pool_id}</span>
                    <Badge variant="outline" className="text-[10px]">
                      Pool
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="success" className="text-[11px]" data-testid={`ready-hosts-${pool.pool_id}`}>
                      {pool.ready_hosts} Ready
                    </Badge>
                    <Badge
                      variant={pool.busy_hosts > 0 ? "warning" : "outline"}
                      className="text-[11px]"
                      data-testid={`busy-hosts-${pool.pool_id}`}
                    >
                      {pool.busy_hosts} Busy
                    </Badge>
                    <Badge
                      variant={pool.offline_hosts > 0 ? "destructive" : "outline"}
                      className="text-[11px]"
                      data-testid={`offline-hosts-${pool.pool_id}`}
                    >
                      {pool.offline_hosts} Offline
                    </Badge>
                  </div>
                </div>

                {/* Qualified Models */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">Qualified Models:</span>
                  <div className="flex flex-wrap items-center gap-1.5" data-testid={`qualified-models-${pool.pool_id}`}>
                    {pool.qualified_models.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground italic">None qualified yet</span>
                    ) : (
                      pool.qualified_models.map((m) => (
                        <Badge key={m} variant="default" className="text-[11px] font-mono">
                          {m}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>

                {/* Member Hosts (Bound) */}
                <div className="space-y-2 pt-1 border-t border-border/40">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Active Member Hosts ({boundHosts.length})
                    </span>
                  </div>

                  {boundHosts.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground italic">No hosts currently bound to this pool.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                      {boundHosts.map((h) => (
                        <div
                          key={h.host_id}
                          className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-background/50 p-2.5"
                          data-testid={`member-host-${h.host_id}`}
                        >
                          <div className="flex flex-col min-w-0">
                            <button
                              type="button"
                              onClick={() => onSelectHost?.(h.host_id)}
                              className="font-medium text-foreground truncate hover:text-primary transition-colors text-left"
                            >
                              {h.label || h.host_id}
                            </button>
                            <span className="text-[10px] text-muted-foreground font-mono truncate">{h.platform}</span>
                          </div>
                          <Badge
                            variant={h.is_connected ? "success" : "destructive"}
                            className="text-[10px] shrink-0 flex items-center gap-1"
                          >
                            {h.is_connected ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
                            <span>{h.is_connected ? "Online" : "Offline"}</span>
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Draining Hosts Subsection */}
                  {drainingHosts.length > 0 && (
                    <div className="pt-2">
                      <span className="text-[11px] font-semibold text-amber-400">
                        Draining Hosts ({drainingHosts.length})
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 mt-1.5">
                        {drainingHosts.map((h) => (
                          <div
                            key={h.host_id}
                            className="flex items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5"
                            data-testid={`draining-host-${h.host_id}`}
                          >
                            <span className="font-medium text-foreground truncate">{h.label || h.host_id}</span>
                            <Badge variant="warning" className="text-[10px] shrink-0">
                              Draining
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
