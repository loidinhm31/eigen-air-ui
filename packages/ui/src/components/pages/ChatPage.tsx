import * as React from "react";
import { useEffect } from "react";
import { ChatPanel } from "../organisms/ChatPanel.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useReadinessStore } from "../../stores/readinessStore.js";
import { getConfigService } from "../../adapters/factory/ServiceFactory.js";

export function ChatPage() {
  const status = useConnectionStore((state) => state.status);
  const url = useConnectionStore((state) => state.url);

  useEffect(() => {
    if (status === "connected") {
      const contextKey = `${url}:${status}`;
      useReadinessStore
        .getState()
        .startPolling((signal) => getConfigService().getReadiness(signal), contextKey);
    } else {
      useReadinessStore.getState().stopPolling();
      useReadinessStore.getState().reset();
    }

    return () => {
      useReadinessStore.getState().stopPolling();
      useReadinessStore.getState().reset();
    };
  }, [status, url]);

  return <ChatPanel />;
}
ChatPage.displayName = "ChatPage";
