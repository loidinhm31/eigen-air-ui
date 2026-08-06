import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../atoms/Card.js";
import { ConnectionStatus } from "../organisms/ConnectionStatus.js";
import { useDebugSettingsStore } from "../../stores/debugSettingsStore.js";

export function SettingsPage() {
  const showPromptDebug = useDebugSettingsStore((state) => state.showPromptDebug);
  const showReasoningDebug = useDebugSettingsStore((state) => state.showReasoningDebug);
  const setShowPromptDebug = useDebugSettingsStore((state) => state.setShowPromptDebug);
  const setShowReasoningDebug = useDebugSettingsStore((state) => state.setShowReasoningDebug);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-lg flex-col gap-4 py-4">
        <h1 className="px-4 pb-1 text-base font-semibold">Settings</h1>
        <ConnectionStatus />
        <div className="px-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Debug Surfaces</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-start justify-between gap-4 rounded-md border border-border/70 px-3 py-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Show prompt debug</p>
                  <p className="text-xs text-muted-foreground">
                    Request and display the exact system prompt for assistant turns.
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  checked={showPromptDebug}
                  onChange={(event) => setShowPromptDebug(event.target.checked)}
                />
              </label>
              <label className="flex items-start justify-between gap-4 rounded-md border border-border/70 px-3 py-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Show reasoning debug</p>
                  <p className="text-xs text-muted-foreground">
                    Request provider-native reasoning text when the model exposes it.
                  </p>
                </div>
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary"
                  checked={showReasoningDebug}
                  onChange={(event) => setShowReasoningDebug(event.target.checked)}
                />
              </label>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

SettingsPage.displayName = "SettingsPage";
