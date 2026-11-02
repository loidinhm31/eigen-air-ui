import * as React from "react";
import { useEffect, useState } from "react";
import { useInferenceStore } from "../../stores/inferenceStore.js";
import { Card, CardContent, CardHeader, CardTitle } from "../atoms/Card.js";
import { OperationProgressCard } from "./OperationProgressCard.js";
import { CompanionDeviceView } from "./CompanionDeviceView.js";
import { InferenceHostsView } from "./InferenceHostsView.js";
import { InferencePoolsView } from "./InferencePoolsView.js";
import { HostModelsView } from "./HostModelsView.js";
import { NativeInferenceQualificationNotice } from "../molecules/NativeInferenceQualificationNotice.js";

export function InferenceSettings() {
  const [activeTab, setActiveTab] = useState<"hosts" | "pools" | "models" | "companion">("hosts");
  const {
    devices,
    loadingDevices,
    companionStatus,
    companionRoots,
    loadingCompanion,
    operations,
    fetchAll,
    cancelOperation,
    revokeDevice,
    retireDevice,
    startCompanion,
    stopCompanion,
    pickCompanionStorageFolder,
    unpairDeviceCompanion,
  } = useInferenceStore();

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);
  const activeOperations = Object.values(operations).filter(
    (op) => op.status === "active" || op.status === "pending"
  );

  useEffect(() => {
    if (activeOperations.length === 0) return;
    const interval = setInterval(() => {
      void fetchAll();
    }, 1000);
    return () => clearInterval(interval);
  }, [activeOperations.length, fetchAll]);
  return (
    <div className="space-y-4">
      <NativeInferenceQualificationNotice />
      {activeOperations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Active Model Operations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {activeOperations.map((op) => (
              <OperationProgressCard
                key={op.operation_id}
                snapshot={op}
                onCancel={(id) => void cancelOperation(id)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Inference & Model Storage</CardTitle>
            <div className="flex flex-wrap rounded-md border border-border/70 p-0.5 bg-muted/20">
              <button
                type="button"
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  activeTab === "companion"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("companion")}
              >
                Companion
              </button>
              <button
                type="button"
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  activeTab === "hosts"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("hosts")}
                data-testid="tab-hosts"
              >
                Hosts
              </button>
              <button
                type="button"
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  activeTab === "pools"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("pools")}
                data-testid="tab-pools"
              >
                Pools
              </button>
              <button
                type="button"
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  activeTab === "models"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("models")}
                data-testid="tab-models"
              >
                Recommendations
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {activeTab === "companion" && (
            <CompanionDeviceView
              status={companionStatus}
              roots={companionRoots}
              devices={devices}
              loading={loadingDevices || loadingCompanion}
              onStartCompanion={startCompanion}
              onStopCompanion={stopCompanion}
              onPickFolder={pickCompanionStorageFolder}
              onRevokeDevice={revokeDevice}
              onRetireDevice={retireDevice}
              onUnpairLocal={unpairDeviceCompanion}
            />
          )}
          {activeTab === "hosts" && <InferenceHostsView />}
          {activeTab === "pools" && <InferencePoolsView />}
          {activeTab === "models" && <HostModelsView />}
        </CardContent>
      </Card>
    </div>
  );
}

InferenceSettings.displayName = "InferenceSettings";
