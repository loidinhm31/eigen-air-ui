import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { useInferenceStore } from "../../stores/inferenceStore.js";
import { Badge } from "../atoms/Badge.js";
import { Spinner } from "../atoms/Spinner.js";
import { HostBindingControls } from "../molecules/HostBindingControls.js";
import { HostRecoveryToggles } from "./host-recovery-toggles.js";
import { HostOperatorRecoverySection } from "./host-operator-recovery-section.js";
import { RefreshCw, Server, Wifi, WifiOff } from "lucide-react";

export interface InferenceHostsViewProps {
  className?: string;
  onSelectHost?: (hostId: string) => void;
}

export function InferenceHostsView({ className = "", onSelectHost }: InferenceHostsViewProps) {
  const {
    hosts,
    hostPreferences,
    hostCaches,
    credentialRecoveries,
    loadingHosts,
    fetchHosts,
    fetchPools,
    fetchHostPreferences,
    fetchHostCaches,
    fetchCredentialRecoveries,
    saveRecoveryPreferences,
    purgeHostCache,
    approveCredentialRecovery,
    denyCredentialRecovery,
  } = useInferenceStore();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const inFlightDetailsRef = useRef<Map<string, Promise<unknown>>>(new Map());

  useEffect(() => {
    void fetchHosts();
    void fetchPools();
    void fetchCredentialRecoveries();
  }, [fetchHosts, fetchPools, fetchCredentialRecoveries]);

  const hostList = Object.values(hosts);

  const loadHostDetails = React.useCallback(
    (hostId: string, force = false): Promise<unknown> => {
      const existing = inFlightDetailsRef.current.get(hostId);
      if (!force && existing) return existing;
      const promise = Promise.allSettled([fetchHostPreferences(hostId), fetchHostCaches(hostId)]).finally(() => {
        inFlightDetailsRef.current.delete(hostId);
      });
      inFlightDetailsRef.current.set(hostId, promise);
      return promise;
    },
    [fetchHostPreferences, fetchHostCaches]
  );

  useEffect(() => {
    hostList.forEach((h) => {
      if (!hostPreferences[h.host_id] || !hostCaches[h.host_id]) {
        void loadHostDetails(h.host_id, false);
      }
    });
  }, [hostList, hostPreferences, hostCaches, loadHostDetails]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.allSettled([fetchHosts(), fetchPools(), fetchCredentialRecoveries(), ...hostList.map((h) => loadHostDetails(h.host_id, true))]);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className={`space-y-6 ${className}`} data-testid="inference-hosts-view">
      {/* View Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" />
            Managed Inference Hosts
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Phase 12 managed inference daemon nodes, binding state, and local KV recovery settings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(loadingHosts || isRefreshing) && <Spinner size="sm" />}
          <button
            type="button"
            disabled={isRefreshing}
            onClick={() => void handleRefresh()}
            className="flex items-center gap-1.5 min-h-[44px] px-3 text-xs text-muted-foreground hover:text-foreground rounded-md border border-border/60 hover:bg-muted/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            data-testid="refresh-hosts-button"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Operator Credential Recovery Section */}
      <HostOperatorRecoverySection
        recoveries={credentialRecoveries}
        onApprove={approveCredentialRecovery}
        onDeny={denyCredentialRecovery}
        onRefresh={fetchCredentialRecoveries}
      />

      {/* Host Cards Grid */}
      <div className="space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Connected & Registered Hosts ({hostList.length})
        </h3>

        {hostList.length === 0 && !loadingHosts ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
            No inference hosts registered. Pair or connect a host daemon to begin.
          </div>
        ) : (
          <div className="grid gap-4">
            {hostList.map((host) => {
              const isConnected = host.is_connected;
              const isLeaseValid = host.lease_valid;

              return (
                <div
                  key={host.host_id}
                  className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-xs shadow-sm hover:border-border/90 transition-colors"
                  data-testid={`host-card-${host.host_id}`}
                >
                  {/* Host Card Header */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectHost?.(host.host_id)}
                          className="font-semibold text-sm text-foreground hover:text-primary transition-colors text-left"
                        >
                          {host.label || host.host_id}
                        </button>
                        <Badge variant="outline" className="text-[10px] uppercase font-mono">
                          {host.platform || "unknown"}
                        </Badge>
                        <Badge variant="default" className="text-[10px]">
                          v{host.agent_version || "1.0.0"}
                        </Badge>
                      </div>
                      <span className="font-mono text-[11px] text-muted-foreground truncate">
                        ID: {host.host_id}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge
                        variant={isConnected ? "success" : "destructive"}
                        className="flex items-center gap-1"
                        data-testid={`connection-status-${host.host_id}`}
                      >
                        {isConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                        <span>{isConnected ? "Connected" : "Offline"}</span>
                      </Badge>
                      <Badge
                        variant={isLeaseValid ? "outline" : "warning"}
                        className="text-[10px]"
                        data-testid={`lease-status-${host.host_id}`}
                      >
                        {isLeaseValid ? "Lease Valid" : "Lease Expired"}
                      </Badge>
                    </div>
                  </div>

                  {/* Embedded Binding Controls */}
                  <HostBindingControls
                    hostId={host.host_id}
                    currentBinding={host.current_binding}
                    appliedRevision={host.applied_binding_revision}
                  />

                  {/* Independent Recovery Toggles & Cache Readiness */}
                  <HostRecoveryToggles
                    hostId={host.host_id}
                    hostRecovery={host.recovery}
                    preferences={hostPreferences[host.host_id]}
                    caches={hostCaches[host.host_id]}
                    onSavePreferences={saveRecoveryPreferences}
                    onPurgeCache={purgeHostCache}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
