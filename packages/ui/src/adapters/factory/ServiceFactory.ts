import type { IChatService } from "./interfaces/IChatService.js";
import type { IMemoryService } from "./interfaces/IMemoryService.js";
import type { IToolService } from "./interfaces/IToolService.js";
import type { ISkillService } from "./interfaces/ISkillService.js";
import type { IConfigService } from "./interfaces/IConfigService.js";
import type { ISessionService } from "./interfaces/ISessionService.js";
import type { IVaultKnowledgeService } from "./interfaces/IVaultKnowledgeService.js";
import type { IUserQuestionService } from "./interfaces/IUserQuestionService.js";
import type { IToolApprovalService } from "./interfaces/IToolApprovalService.js";
import type { HttpRunAdapter } from "../http/HttpRunAdapter.js";
import type { RunAccessContext } from "../http/HttpRunAdapter.js";
import { getStoredAuthToken } from "./tokenStorage.js";

let chatService: IChatService | null = null;
let memoryService: IMemoryService | null = null;
let toolService: IToolService | null = null;
let skillService: ISkillService | null = null;
let configService: IConfigService | null = null;
let sessionService: ISessionService | null = null;
let vaultKnowledgeService: IVaultKnowledgeService | null = null;
let userQuestionService: IUserQuestionService | null = null;
let toolApprovalService: IToolApprovalService | null = null;
let runService: HttpRunAdapter | null = null;
let serviceAccessContext: RunAccessContext = {
  authToken: typeof window !== "undefined" ? getStoredAuthToken() : undefined,
};
let serviceAccessRevision = 0;

// Registered by the app entry (init.ts) so UI components can trigger re-init
// without depending on the app layer.
let _reinitFn: (() => void) | null = null;

export function registerReinitFn(fn: () => void): void {
  _reinitFn = fn;
}

/** Re-creates all service adapters with the current URL from the connection store. */
export function reinitServices(): void {
  _reinitFn?.();
}

/**
 * Returns true when an app-layer init function has been registered.
 * Used by NonclawApp to skip its own adapter creation in apps/web mode,
 * where init.ts already owns the service lifecycle.
 */
export function hasReinitFn(): boolean {
  return _reinitFn !== null;
}

/** Ephemeral host access; never persisted or included in question state. */
export function setServiceAccessContext(context: RunAccessContext | undefined): void {
  const next = context ? { ...context } : {};
  if (
    serviceAccessContext.authToken !== next.authToken ||
    serviceAccessContext.identityKey !== next.identityKey ||
    serviceAccessContext.capabilities !== next.capabilities
  ) {
    serviceAccessRevision += 1;
  }
  serviceAccessContext = next;
}

export function getServiceAccessContext(): RunAccessContext {
  const token =
    serviceAccessContext.authToken ||
    (typeof window !== "undefined" ? getStoredAuthToken() : undefined);
  return {
    ...serviceAccessContext,
    ...(token ? { authToken: token } : {}),
    accessRevision: serviceAccessRevision,
  };
}

export function setChatService(s: IChatService) {
  // Tear down previous WS connection before replacing to prevent ghost sockets.
  chatService?.disconnect();
  chatService = s;
}
export function setMemoryService(s: IMemoryService) {
  memoryService = s;
}
export function setToolService(s: IToolService) {
  toolService = s;
}
export function setSkillService(s: ISkillService) {
  skillService = s;
}
export function setConfigService(s: IConfigService) {
  configService = s;
}
export function setSessionService(s: ISessionService) {
  sessionService = s;
}
export function setVaultKnowledgeService(s: IVaultKnowledgeService) {
  vaultKnowledgeService = s;
}
export function setToolApprovalService(s: IToolApprovalService) {
  toolApprovalService = s;
}
export function setUserQuestionService(s: IUserQuestionService) {
  userQuestionService = s;
}
export function setRunService(s: HttpRunAdapter) {
  runService = s;
}

export function getChatService(): IChatService {
  if (!chatService) throw new Error("IChatService not initialized");
  return chatService;
}
export function getMemoryService(): IMemoryService {
  if (!memoryService) throw new Error("IMemoryService not initialized");
  return memoryService;
}
export function getToolService(): IToolService {
  if (!toolService) throw new Error("IToolService not initialized");
  return toolService;
}
export function getSkillService(): ISkillService {
  if (!skillService) throw new Error("ISkillService not initialized");
  return skillService;
}
export function getConfigService(): IConfigService {
  if (!configService) throw new Error("IConfigService not initialized");
  return configService;
}
export function getSessionService(): ISessionService {
  if (!sessionService) throw new Error("ISessionService not initialized");
  return sessionService;
}
export function getVaultKnowledgeService(): IVaultKnowledgeService {
  if (!vaultKnowledgeService) throw new Error("IVaultKnowledgeService not initialized");
  return vaultKnowledgeService;
}
export function getUserQuestionService(): IUserQuestionService {
  if (!userQuestionService) throw new Error("IUserQuestionService not initialized");
  return userQuestionService;
}

export function getToolApprovalService(): IToolApprovalService {
  if (!toolApprovalService) throw new Error("IToolApprovalService not initialized");
  return toolApprovalService;
}

export function getRunService(): HttpRunAdapter {
  if (!runService) throw new Error("HttpRunAdapter not initialized");
  return runService;
}

export type {
  IChatService,
  IMemoryService,
  IToolService,
  ISkillService,
  IConfigService,
  ISessionService,
  IVaultKnowledgeService,
  IUserQuestionService,
  IToolApprovalService,
};
export type { StreamEventCallback } from "./interfaces/IChatService.js";
