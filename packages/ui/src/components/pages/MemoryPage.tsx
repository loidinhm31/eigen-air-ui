import * as React from "react";
import { MemoryBrowser } from "../organisms/MemoryBrowser.js";
import { EpisodeBrowser } from "../organisms/EpisodeBrowser.js";

export function MemoryPage() {
  return (
    <div className="h-full space-y-4 overflow-auto p-4">
      <MemoryBrowser />
      <EpisodeBrowser />
    </div>
  );
}
MemoryPage.displayName = "MemoryPage";
