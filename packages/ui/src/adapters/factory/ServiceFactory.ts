import type { IChatService } from "./interfaces/IChatService.js";
import type { IMemoryService } from "./interfaces/IMemoryService.js";
import type { IToolService } from "./interfaces/IToolService.js";
import type { ISkillService } from "./interfaces/ISkillService.js";
import type { IConfigService } from "./interfaces/IConfigService.js";

let chatService: IChatService | null = null;
let memoryService: IMemoryService | null = null;
let toolService: IToolService | null = null;
let skillService: ISkillService | null = null;
let configService: IConfigService | null = null;

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

export type { IChatService, IMemoryService, IToolService, ISkillService, IConfigService };
export type { StreamEventCallback } from "./interfaces/IChatService.js";
