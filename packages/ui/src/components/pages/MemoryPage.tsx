import * as React from "react";
import { MemoryBrowser } from "../organisms/MemoryBrowser.js";
import { VaultKnowledgeSection } from "../organisms/VaultKnowledgeSection.js";

export function MemoryPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <MemoryBrowser />
      </div>
      <div className="min-h-0 flex-1 px-4 pb-4">
        <VaultKnowledgeSection />
      </div>
    </div>
  );
}
MemoryPage.displayName = "MemoryPage";
