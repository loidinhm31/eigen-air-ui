import { useConnectionStore } from "@eigen-air-ui/ui/stores";
import {
  registerReinitFn,
  initServicesForDaemonUrl,
  setLocalCompanionService,
} from "@eigen-air-ui/ui";
import { TauriCompanionService } from "./TauriCompanionService";

export function initServices() {
  initServicesForDaemonUrl(useConnectionStore.getState().url);
  setLocalCompanionService(new TauriCompanionService());
}

registerReinitFn(initServices);
