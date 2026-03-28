import type { IToolService } from "../factory/interfaces/IToolService.js";
import type { Tool, ToolInvokeResult } from "@nonclaw-ui/shared/types";

export class HttpToolAdapter implements IToolService {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, init);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message ?? `Request failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  list(): Promise<Tool[]> {
    return this.request("/v1/tools");
  }

  invoke(name: string, args: Record<string, unknown>): Promise<ToolInvokeResult> {
    return this.request("/v1/tools/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, arguments: args }),
    });
  }
}
