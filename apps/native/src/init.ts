import { useConnectionStore } from "@nonclaw-ui/ui/stores";
import {
  registerReinitFn,
  initServicesForDaemonUrl,
} from "@nonclaw-ui/ui";

export function initServices() {
  initServicesForDaemonUrl(useConnectionStore.getState().url);
}

registerReinitFn(initServices);
