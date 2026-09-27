import { useConnectionStore } from "@eigen-air-ui/ui/stores";
import {
  registerReinitFn,
  initServicesForDaemonUrl,
} from "@eigen-air-ui/ui";

export function initServices() {
  initServicesForDaemonUrl(useConnectionStore.getState().url);
}

registerReinitFn(initServices);
