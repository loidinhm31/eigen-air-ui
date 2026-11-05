import type {
  ExecutionTargetInput,
  Session,
  SessionsListParams,
  SessionsListResponse,
} from "@eigen-air-ui/shared/types";

export interface ISessionService {
  listSessions(query?: SessionsListParams): Promise<SessionsListResponse>;
  getSession(id: string): Promise<Session | null>;
  createSession(target?: ExecutionTargetInput): Promise<Session>;
  deleteSession(id: string): Promise<boolean>;
}
