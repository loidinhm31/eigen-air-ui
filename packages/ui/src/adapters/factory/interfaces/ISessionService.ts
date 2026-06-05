import type { Session } from "@nonclaw-ui/shared/types";

export interface ISessionService {
  listSessions(): Promise<Session[]>;
  createSession(): Promise<Session>;
  deleteSession(id: string): Promise<boolean>;
}
