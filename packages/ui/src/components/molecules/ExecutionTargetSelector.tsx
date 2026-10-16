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
  const activeDevices = devices.filter((d) => d.status === "active");

  const isServer = !value || value.kind === "server";
  const selectedDeviceId = value?.kind === "client_device" ? value.device_id : "";

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <label className="font-medium text-foreground">Inference Target</label>
      <div className="flex flex-wrap gap-2">
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

        {activeDevices.map((d) => {
          const isSelected = selectedDeviceId === d.device_id;
          return (
            <button
              key={d.device_id}
              type="button"
              disabled={disabled}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-medium transition-colors ${
                isSelected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-accent"
              } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              onClick={() =>
                onChange({
                  kind: "client_device",
                  device_id: d.device_id,
                  model_artifact_id: "gemma-4-e4b-it-qat-ud-q4_k_xl",
                })
              }
            >
              <span>{d.display_label || `Device ${d.device_id.slice(0, 6)}`}</span>
              <Badge variant="outline" className="text-[10px]">
                Companion
              </Badge>
            </button>
          );
        })}
      </div>
    </div>
  );
}

ExecutionTargetSelector.displayName = "ExecutionTargetSelector";
