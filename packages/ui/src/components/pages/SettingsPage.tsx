import * as React from "react";
import { ConnectionStatus } from "../organisms/ConnectionStatus.js";

export function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto py-4">
        <h1 className="px-4 pb-3 text-base font-semibold">Settings</h1>
        <ConnectionStatus />
      </div>
    </div>
  );
}
SettingsPage.displayName = "SettingsPage";
