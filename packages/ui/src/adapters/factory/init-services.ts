import { HttpConfigAdapter } from "../http/HttpConfigAdapter.js";
import { HttpMemoryAdapter } from "../http/HttpMemoryAdapter.js";
import { HttpSkillAdapter } from "../http/HttpSkillAdapter.js";
import { HttpToolAdapter } from "../http/HttpToolAdapter.js";
import { HttpVaultKnowledgeAdapter } from "../http/HttpVaultKnowledgeAdapter.js";
import { HttpUserQuestionAdapter } from "../http/HttpUserQuestionAdapter.js";
import { HttpToolApprovalAdapter } from "../http/HttpToolApprovalAdapter.js";
import { HttpRunAdapter } from "../http/HttpRunAdapter.js";
import { WsChatAdapter } from "../ws/WsChatAdapter.js";
import {
  setChatService,
  setConfigService,
  setMemoryService,
  setSessionService,
  setSkillService,
  setToolService,
  setVaultKnowledgeService,
  setUserQuestionService,
  setToolApprovalService,
  setRunService,
  getServiceAccessContext,
} from "./ServiceFactory.js";

export interface NormalizedDaemonUrls {
  httpUrl: string;
  wsUrl: string;
}

export function normalizeDaemonUrl(daemonUrl: string): NormalizedDaemonUrls {
  let parsed: URL;
  try {
    parsed = new URL(daemonUrl);
  } catch {
    throw new Error("Invalid daemon URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Invalid daemon URL protocol: expected http or https");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Invalid daemon URL: userinfo is not allowed");
  }

  if (parsed.search) {
    throw new Error("Invalid daemon URL: query parameters are not allowed");
  }

  if (parsed.hash) {
    throw new Error("Invalid daemon URL: fragments are not allowed");
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  const httpUrl = `${parsed.protocol}//${parsed.host}${normalizedPath}`;
  const wsProtocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProtocol}//${parsed.host}${normalizedPath}/ws`;

  return { httpUrl, wsUrl };
}

export function initServicesForDaemonUrl(daemonUrl: string): void {
  const { httpUrl, wsUrl } = normalizeDaemonUrl(daemonUrl);

  const access = () => getServiceAccessContext();
  const wsAdapter = new WsChatAdapter(wsUrl, access);
  setChatService(wsAdapter);
  setSessionService(wsAdapter);
  setMemoryService(new HttpMemoryAdapter(httpUrl, access));
  setToolService(new HttpToolAdapter(httpUrl, access));
  setSkillService(new HttpSkillAdapter(httpUrl, access));
  setConfigService(new HttpConfigAdapter(httpUrl, access));
  setVaultKnowledgeService(new HttpVaultKnowledgeAdapter(httpUrl, access));
  setUserQuestionService(new HttpUserQuestionAdapter(httpUrl, access));
  setToolApprovalService(new HttpToolApprovalAdapter(httpUrl, access));
  setRunService(new HttpRunAdapter(httpUrl, access));
}
