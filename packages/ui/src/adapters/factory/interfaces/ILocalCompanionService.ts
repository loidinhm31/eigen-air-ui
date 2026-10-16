import type {
  LocalCompanionStatus,
  LocalControlCommand,
  LocalControlResponse,
} from "@eigen-air-ui/shared/types";

export interface ILocalCompanionService {
  isAvailable(): boolean;
  getStatus(): Promise<LocalCompanionStatus>;
  start(): Promise<void>;
  stop(keepRunning: boolean): Promise<void>;
  sendCommand(cmd: LocalControlCommand): Promise<LocalControlResponse>;
  pickStorageFolder(label?: string): Promise<{ path: string; root_id?: string; cancelled?: boolean }>;
}
