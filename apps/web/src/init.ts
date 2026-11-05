import { useConnectionStore } from "@eigen-air-ui/ui/stores";
import {
  registerReinitFn,
  initServicesForDaemonUrl,
  setServiceAccessContext,
  setLocalCompanionService,
  getStoredAuthToken,
} from "@eigen-air-ui/ui";
import { DEFAULT_DAEMON_URL } from "@eigen-air-ui/shared/constants";

export function initServices() {
  // Browser environment has no embedded/IPC local companion controller.
  setLocalCompanionService(null);

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

    const token = getStoredAuthToken();
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
