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

export function setChatService(s: IChatService) {
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
