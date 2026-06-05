import { useConnectionStore } from "@nonclaw-ui/ui/stores";
import {
  setChatService,
  setMemoryService,
  setToolService,
  setSkillService,
  setConfigService,
  setSessionService,
  setVaultKnowledgeService,
  registerReinitFn,
  WsChatAdapter,
  HttpMemoryAdapter,
  HttpToolAdapter,
  HttpSkillAdapter,
  HttpConfigAdapter,
  HttpVaultKnowledgeAdapter,
} from "@nonclaw-ui/ui";

export function initServices() {
  const daemonUrl = useConnectionStore.getState().url.replace(/\/+$/, "");
  const wsUrl = daemonUrl.replace(/^http/, "ws") + "/ws";

  const wsAdapter = new WsChatAdapter(wsUrl);
  setChatService(wsAdapter);
  setSessionService(wsAdapter);
  setMemoryService(new HttpMemoryAdapter(daemonUrl));
  setToolService(new HttpToolAdapter(daemonUrl));
  setSkillService(new HttpSkillAdapter(daemonUrl));
  setConfigService(new HttpConfigAdapter(daemonUrl));
  setVaultKnowledgeService(new HttpVaultKnowledgeAdapter(daemonUrl));
}

registerReinitFn(initServices);
