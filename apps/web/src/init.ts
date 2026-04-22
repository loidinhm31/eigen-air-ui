import { useConnectionStore } from "@nonclaw-ui/ui/stores";
import {
  setChatService,
  setMemoryService,
  setToolService,
  setSkillService,
  setConfigService,
  registerReinitFn,
  WsChatAdapter,
  HttpMemoryAdapter,
  HttpToolAdapter,
  HttpSkillAdapter,
  HttpConfigAdapter,
} from "@nonclaw-ui/ui";

export function initServices() {
  // Normalize: strip trailing slash so URLs like "http://host/" don't produce "ws://host//ws".
  const daemonUrl = useConnectionStore.getState().url.replace(/\/+$/, "");
  const wsUrl = daemonUrl.replace(/^http/, "ws") + "/ws";

  setChatService(new WsChatAdapter(wsUrl));
  setMemoryService(new HttpMemoryAdapter(daemonUrl));
  setToolService(new HttpToolAdapter(daemonUrl));
  setSkillService(new HttpSkillAdapter(daemonUrl));
  setConfigService(new HttpConfigAdapter(daemonUrl));
}

// Allow UI-layer components to trigger re-init when the daemon URL changes.
registerReinitFn(initServices);
