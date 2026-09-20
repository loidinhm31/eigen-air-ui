import { useConnectionStore } from "@nonclaw-ui/ui/stores";
import {
  registerReinitFn,
  initServicesForDaemonUrl,
  setServiceAccessContext,
  getStoredAuthToken,
  saveStoredAuthToken,
} from "@nonclaw-ui/ui";
import { DEFAULT_AUTH_TOKEN, DEFAULT_DAEMON_URL } from "@nonclaw-ui/shared/constants";

export function initServices() {
  if (typeof window !== "undefined") {
    // If accessed from remote host (e.g. 100.91.26.60) but store has localhost, align to remote daemon
    const connectionStore = useConnectionStore.getState();
    if (
      window.location?.hostname &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1" &&
      connectionStore.url.includes("localhost")
    ) {
      connectionStore.setUrl(DEFAULT_DAEMON_URL);
    }

    // Ensure default auth token is populated in storage and access context
    let token = getStoredAuthToken();
    if (!token && DEFAULT_AUTH_TOKEN) {
      saveStoredAuthToken(DEFAULT_AUTH_TOKEN, "forever");
      token = DEFAULT_AUTH_TOKEN;
    }
    if (token) {
      setServiceAccessContext({
        authToken: token,
        capabilities: new Set(["run:read:debug", "run:export", "run:delete"]),
      });
    }
  }
  initServicesForDaemonUrl(useConnectionStore.getState().url);
}

// Allow UI-layer components to trigger re-init when the daemon URL changes.
registerReinitFn(initServices);
