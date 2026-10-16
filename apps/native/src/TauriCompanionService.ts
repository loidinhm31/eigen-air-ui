import { invoke } from "@tauri-apps/api/core";
import type { ILocalCompanionService } from "@eigen-air-ui/ui";
import type {
  LocalCompanionStatus,
  LocalControlCommand,
  LocalControlResponse,
} from "@eigen-air-ui/shared/types";

export class TauriCompanionService implements ILocalCompanionService {
  isAvailable(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  }
  async getStatus(): Promise<LocalCompanionStatus> {
    try {
      const res = await invoke<LocalCompanionStatus>("companion_status");
      return res;
    } catch {
      return {
        version: "unknown",
        status: "stopped",
        active_root: "",
        queued_requests: 0,
        model_loaded: false,
      };
    }
  }

  async start(): Promise<void> {
    await invoke("companion_start");
  }

  async stop(keepRunning: boolean): Promise<void> {
    await invoke("companion_stop", { keepRunning });
  }

  async sendCommand(cmd: LocalControlCommand): Promise<LocalControlResponse> {
    return invoke<LocalControlResponse>("companion_send", { cmd });
  }

  async pickStorageFolder(label?: string): Promise<{ path: string; root_id?: string; cancelled?: boolean }> {
    const res = await invoke<{ path: string | null; cancelled: boolean }>("pick_storage_folder", {
      title: label ?? "Select Storage Root",
    });
    return {
      path: res.path ?? "",
      cancelled: res.cancelled,
    };
  }
}
