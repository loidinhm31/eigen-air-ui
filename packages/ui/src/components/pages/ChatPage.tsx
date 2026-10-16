import * as React from "react";
import { useEffect, useState } from "react";
import { ChatPanel } from "../organisms/ChatPanel.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useReadinessStore } from "../../stores/readinessStore.js";
import {
  getConfigService,
  getServiceAccessContext,
  registerAccessInvalidationListener,
} from "../../adapters/factory/ServiceFactory.js";
export function ChatPage() {
  const status = useConnectionStore((state) => state.status);
  const url = useConnectionStore((state) => state.url);
  const [accessRevision, setAccessRevision] = useState(
    () => getServiceAccessContext().accessRevision ?? 0
  );

  useEffect(() => {
    return registerAccessInvalidationListener((rev) => setAccessRevision(rev));
  }, []);

  useEffect(() => {
    if (status === "connected") {
      const contextKey = `${url}:${status}:${accessRevision}`;
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
  }, [status, url, accessRevision]);

  return <ChatPanel />;
}
ChatPage.displayName = "ChatPage";
