import * as React from "react";
import { useEffect, useState } from "react";
import { useInferenceStore } from "../../stores/inferenceStore.js";
import { Card, CardContent, CardHeader, CardTitle } from "../atoms/Card.js";
import { OperationProgressCard } from "./OperationProgressCard.js";
import { ServerModelsView } from "./ServerModelsView.js";
import { CompanionDeviceView } from "./CompanionDeviceView.js";

export function InferenceSettings() {
  const [activeTab, setActiveTab] = useState<"server" | "companion">("server");

  const {
    serverModels,
    serverRoots,
    selectedServerRootId,
    loadingServerModels,
    devices,
    loadingDevices,
    companionStatus,
    companionRoots,
    loadingCompanion,
    operations,
    fetchAll,
    selectServerRoot,
    downloadServerModel,
    deleteServerModel,
    loadServerModel,
    unloadServerModel,
    prepareServerModelCache,
    purgeServerModelCache,
    cancelServerOperation,
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

  return (
    <div className="space-y-4">
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
                onCancel={(id) => void cancelServerOperation(id)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Inference & Model Storage</CardTitle>
            <div className="flex rounded-md border border-border/70 p-0.5 bg-muted/20">
              <button
                type="button"
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  activeTab === "server"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("server")}
              >
                Server
              </button>
              <button
                type="button"
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  activeTab === "companion"
                    ? "bg-background text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setActiveTab("companion")}
              >
                Companion
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {activeTab === "server" ? (
            <ServerModelsView
              models={serverModels}
              roots={serverRoots}
              selectedRootId={selectedServerRootId}
              loading={loadingServerModels}
              onSelectRoot={selectServerRoot}
              onDownload={async (id) => {
                await downloadServerModel(id);
              }}
              onDelete={deleteServerModel}
              onLoad={loadServerModel}
              onUnload={unloadServerModel}
              onPrepareCache={async (id) => {
                await prepareServerModelCache(id);
              }}
              onPurgeCache={purgeServerModelCache}
            />
          ) : (
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
        </CardContent>
      </Card>
    </div>
  );
}

InferenceSettings.displayName = "InferenceSettings";
