import * as React from "react";
import type { ExecutionTargetInput } from "@eigen-air-ui/shared/types";
import { useInferenceStore } from "../../stores/inferenceStore.js";
import { Badge } from "../atoms/Badge.js";

export interface ExecutionTargetSelectorProps {
  value?: ExecutionTargetInput;
  onChange: (target: ExecutionTargetInput) => void;
  disabled?: boolean;
}

export function ExecutionTargetSelector({
  value,
  onChange,
  disabled = false,
}: ExecutionTargetSelectorProps) {
  const devices = useInferenceStore((state) => state.devices);
  const pools = useInferenceStore((state) => state.pools);
  const activeDevices = devices.filter((d) => d.status === "active");
  const poolList = Object.values(pools);

  const isServer = !value || value.kind === "server";
  const selectedDeviceId = value?.kind === "client_device" ? value.device_id : "";
  const selectedPoolId = value?.kind === "pool" ? value.pool_id : "";

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <label className="font-medium text-foreground">Inference Target</label>
      <div className="flex flex-wrap gap-2">
        {/* Server Target */}
        <button
          type="button"
          disabled={disabled}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-medium transition-colors ${
            isServer
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card text-muted-foreground hover:bg-accent"
          } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          onClick={() => onChange({ kind: "server" })}
        >
          <span>Server</span>
          <Badge variant="outline" className="text-[10px]">
            Default
          </Badge>
        </button>

        {/* Pool Targets (Phase 12 Managed Gateway) */}
        {poolList.map((p) => {
          const isSelected = selectedPoolId === p.pool_id;
          const isReady = p.ready_hosts > 0;
          const defaultModel = p.qualified_models[0] || "gemma-4-e4b-it-qat-ud-q4_k_xl";
          return (
            <button
              key={p.pool_id}
              type="button"
              disabled={disabled}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-medium transition-colors ${
                isSelected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-accent"
              } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              onClick={() =>
                onChange({
                  kind: "pool",
                  pool_id: p.pool_id,
                  model_artifact_id:
                    isSelected && value?.kind === "pool" ? value.model_artifact_id : defaultModel,
                })
              }
            >
              <span>Pool: {p.pool_id}</span>
              <Badge
                variant={isReady ? "default" : "outline"}
                className={`text-[10px] ${!isReady ? "border-amber-500/40 text-amber-400" : ""}`}
              >
                {p.ready_hosts > 0 ? `${p.ready_hosts} Ready` : "No Hosts"}
              </Badge>
            </button>
          );
        })}

        {/* Legacy Client Devices (Migration Required) */}
        {activeDevices.map((d) => {
          const isSelected = selectedDeviceId === d.device_id;
          const meta = d.runtime_metadata ?? {};
          const isOffline = meta.connected === false || meta.online === false;
          const defaultModel = "gemma-4-e4b-it-qat-ud-q4_k_xl";
          return (
            <button
              key={d.device_id}
              type="button"
              disabled={disabled || isOffline}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-medium transition-colors ${
                isSelected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-accent"
              } ${disabled || isOffline ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              onClick={() =>
                onChange({
                  kind: "client_device",
                  device_id: d.device_id,
                  model_artifact_id:
                    isSelected && value?.kind === "client_device"
                      ? value.model_artifact_id
                      : defaultModel,
                })
              }
            >
              <span>{d.display_label || `Device ${d.device_id.slice(0, 6)}`}</span>
              <Badge variant={isOffline ? "destructive" : "outline"} className="text-[10px]">
                {isOffline ? "Offline" : "Legacy Device"}
              </Badge>
            </button>
          );
        })}
      </div>

      {/* Pool Model Selector */}
      {value?.kind === "pool" && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[11px] text-muted-foreground">Pool Model:</span>
          {pools[value.pool_id]?.qualified_models?.map((m) => (
            <button
              key={m}
              type="button"
              disabled={disabled}
              className={`rounded px-2 py-0.5 text-[11px] border font-medium transition-colors cursor-pointer ${
                value.model_artifact_id === m
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
              onClick={() =>
                onChange({
                  ...value,
                  model_artifact_id: m,
                })
              }
            >
              {m}
            </button>
          ))}
          {(!pools[value.pool_id]?.qualified_models ||
            pools[value.pool_id].qualified_models.length === 0) && (
            <span className="text-[10px] text-muted-foreground">
              {value.model_artifact_id} (Configured)
            </span>
          )}
        </div>
      )}

      {/* Legacy Client Device Model Family Selector */}
      {value?.kind === "client_device" && value.device_id && (
        <div className="flex flex-col gap-1 pt-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Model Family:</span>
            <button
              type="button"
              disabled={disabled}
              className={`rounded px-2 py-0.5 text-[11px] border font-medium transition-colors cursor-pointer ${
                value.model_artifact_id === "gemma-4-e4b-it-qat-ud-q4_k_xl"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
              onClick={() =>
                onChange({
                  kind: "client_device",
                  device_id: value.device_id,
                  model_artifact_id: "gemma-4-e4b-it-qat-ud-q4_k_xl",
                })
              }
            >
              Gemma 4
            </button>
            <button
              type="button"
              disabled={disabled}
              className={`rounded px-2 py-0.5 text-[11px] border font-medium transition-colors cursor-pointer ${
                value.model_artifact_id === "qwen-3.8-27b-ud-q4_k_xl"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
              onClick={() =>
                onChange({
                  kind: "client_device",
                  device_id: value.device_id,
                  model_artifact_id: "qwen-3.8-27b-ud-q4_k_xl",
                })
              }
            >
              Qwen 3.8
            </button>
          </div>
          <p className="text-[10px] text-amber-400/90">
            Migration Note: Direct client device targets are legacy. Pool targets are recommended.
          </p>
        </div>
      )}
    </div>
  );
}

ExecutionTargetSelector.displayName = "ExecutionTargetSelector";
