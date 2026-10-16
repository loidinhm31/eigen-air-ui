import type { ExecutionTargetInput, Session } from "@eigen-air-ui/shared/types";

export interface ISessionService {
  listSessions(): Promise<Session[]>;
  createSession(target?: ExecutionTargetInput): Promise<Session>;
  deleteSession(id: string): Promise<boolean>;
}
