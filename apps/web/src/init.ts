import { useConnectionStore } from "@nonclaw-ui/ui/stores";
import {
  registerReinitFn,
  initServicesForDaemonUrl,
} from "@nonclaw-ui/ui";

export function initServices() {
  initServicesForDaemonUrl(useConnectionStore.getState().url);
}

// Allow UI-layer components to trigger re-init when the daemon URL changes.
registerReinitFn(initServices);
