import { HttpConfigAdapter } from "../http/HttpConfigAdapter.js";
import { HttpMemoryAdapter } from "../http/HttpMemoryAdapter.js";
import { HttpSkillAdapter } from "../http/HttpSkillAdapter.js";
import { HttpToolAdapter } from "../http/HttpToolAdapter.js";
import { HttpVaultKnowledgeAdapter } from "../http/HttpVaultKnowledgeAdapter.js";
import { WsChatAdapter } from "../ws/WsChatAdapter.js";
import {
  setChatService,
  setConfigService,
  setMemoryService,
  setSessionService,
  setSkillService,
  setToolService,
  setVaultKnowledgeService,
} from "./ServiceFactory.js";

export function initServicesForDaemonUrl(daemonUrl: string): void {
  const normalizedUrl = daemonUrl.replace(/\/+$/, "");
  const wsUrl = normalizedUrl.startsWith("https")
    ? normalizedUrl.replace("https", "wss") + "/ws"
    : normalizedUrl.replace("http", "ws") + "/ws";

  const wsAdapter = new WsChatAdapter(wsUrl);
  setChatService(wsAdapter);
  setSessionService(wsAdapter);
  setMemoryService(new HttpMemoryAdapter(normalizedUrl));
  setToolService(new HttpToolAdapter(normalizedUrl));
  setSkillService(new HttpSkillAdapter(normalizedUrl));
  setConfigService(new HttpConfigAdapter(normalizedUrl));
  setVaultKnowledgeService(new HttpVaultKnowledgeAdapter(normalizedUrl));
}
