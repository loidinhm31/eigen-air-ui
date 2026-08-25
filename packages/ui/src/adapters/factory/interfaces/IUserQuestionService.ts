import type {
  UserQuestionAnswer,
  UserQuestionListResponse,
  UserQuestionMutationResponse,
  UserQuestionSnapshot,
} from "@nonclaw-ui/shared/types";

export interface UserQuestionQuery {
  sessionId: string;
  runId?: string;
}

export interface IUserQuestionService {
  list(query: UserQuestionQuery, signal?: AbortSignal): Promise<UserQuestionListResponse>;
  get(
    questionId: string,
    query: Required<UserQuestionQuery>,
    signal?: AbortSignal
  ): Promise<UserQuestionSnapshot>;
  resolve(
    questionId: string,
    query: Required<UserQuestionQuery>,
    expectedRevision: number,
    mutationToken: string,
    answer: UserQuestionAnswer,
    signal?: AbortSignal
  ): Promise<UserQuestionMutationResponse>;
  cancel(
    questionId: string,
    query: Required<UserQuestionQuery>,
    expectedRevision: number,
    mutationToken: string,
    signal?: AbortSignal
  ): Promise<UserQuestionMutationResponse>;
}
