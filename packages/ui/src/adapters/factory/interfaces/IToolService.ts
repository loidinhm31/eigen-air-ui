import type { Tool, ToolInvokeResult } from "@nonclaw-ui/shared/types";

export interface IToolService {
  list(): Promise<Tool[]>;
  invoke(name: string, args: Record<string, unknown>): Promise<ToolInvokeResult>;
}
