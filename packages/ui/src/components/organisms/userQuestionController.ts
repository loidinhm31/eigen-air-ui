import {
  decodeChatHistoryResponse,
  decodeRunSnapshot,
  decodeUserQuestionAnswer,
  type ChatHistoryResponse,
  type UserQuestionAnswer,
  type UserQuestionSnapshot,
  type UserQuestionUpdatedEvent,
  UserQuestionDecodeError,
} from "@nonclaw-ui/shared/types";
import type { IUserQuestionService } from "../../adapters/factory/interfaces/IUserQuestionService.js";
import { UserQuestionHttpError } from "../../adapters/http/HttpUserQuestionAdapter.js";
import {
  pendingQuestionSnapshot,
  isQuestionActiveState,
  useUserQuestionStore,
  type UserQuestionContext,
} from "../../stores/userQuestionStore.js";

export interface UserQuestionControllerOptions {
  service: IUserQuestionService;
  getHistory?: (sessionId: string, signal: AbortSignal) => Promise<unknown>;
  getRunSnapshot?: (runId: string, signal: AbortSignal) => Promise<unknown>;
  onHistorySnapshot?: (history: ChatHistoryResponse) => void;
}

interface MutationFence {
  generation: number;
  contextEpoch: number;
  questionId: string;
  sessionId: string;
  runId: string;
  abort: AbortController;
}

function answerForQuestion(question: UserQuestionSnapshot, value: string): UserQuestionAnswer {
  if (!question.request) throw new Error("Question input unavailable");
  const answer =
    question.request.kind === "single_choice"
      ? { kind: "single_choice" as const, option_id: value }
      : question.request.kind === "short_text"
        ? { kind: "short_text" as const, text: value }
        : { kind: "multiline" as const, text: value };
  return decodeUserQuestionAnswer(answer, question.request);
}

export class UserQuestionController {
  private context?: UserQuestionContext;
  private generation = 0;
  private contextEpoch = 0;
  private refreshPromise?: Promise<boolean>;
  private refreshQueued = false;
  private refreshAbort?: AbortController;
  private mutationAbort?: AbortController;
  private activeMutation?: MutationFence;
  private readonly mutationTokens = new Map<string, string>();
  private readonly questionRunIds = new Set<string>();

  constructor(private readonly options: UserQuestionControllerOptions) {}

  setContext(context: UserQuestionContext | undefined): void {
    const previous = this.context;
    if (
      context &&
      previous &&
      context.daemonUrl === previous.daemonUrl &&
      context.sessionId === previous.sessionId &&
      context.identityKey === previous.identityKey &&
      context.accessRevision === previous.accessRevision
    ) {
      return;
    }
    this.contextEpoch += 1;
    this.refreshAbort?.abort();
    this.mutationAbort?.abort();
    this.activeMutation = undefined;
    this.mutationTokens.clear();
    this.questionRunIds.clear();
    this.refreshQueued = false;
    this.refreshPromise = undefined;
    this.refreshAbort = undefined;
    this.context = context;
    if (!context) {
      this.generation = useUserQuestionStore.getState().generation;
      useUserQuestionStore.getState().clearAll("idle");
      return;
    }
    this.generation = useUserQuestionStore.getState().beginGeneration(context);
  }

  onConnectionStatus(status: "connected" | "connecting" | "disconnected"): void {
    if (!this.context) return;
    if (status === "connected") {
      void this.refresh();
    } else {
      useUserQuestionStore.getState().markOffline(this.generation);
    }
  }

  onQuestionHint(event?: UserQuestionUpdatedEvent): void {
    void event;
    if (!this.context) return;
    if (this.refreshPromise) this.refreshQueued = true;
    useUserQuestionStore.getState().recordQuestionHint(this.generation, event);
    void this.refresh();
  }

  async refresh(): Promise<boolean> {
    if (!this.context) return false;
    if (this.refreshPromise) return this.refreshPromise;
    const generation = this.generation;
    const context = this.context;
    const contextEpoch = this.contextEpoch;
    const abort = new AbortController();
    this.refreshAbort = abort;
    useUserQuestionStore.getState().beginRefresh(generation);

    const promise = (async (): Promise<boolean> => {
      try {
        const list = await this.options.service.list(
          { sessionId: context.sessionId },
          abort.signal
        );
        const metadata = list.questions;
        const active = metadata.filter((question) => isQuestionActiveState(question.state));
        active.forEach((question) => this.questionRunIds.add(question.run_id));

        const history = this.options.getHistory
          ? await this.options.getHistory(context.sessionId, abort.signal)
          : undefined;
        const runSnapshots = this.options.getRunSnapshot
          ? await Promise.all(
              active.map((question) =>
                this.options.getRunSnapshot!(question.run_id, abort.signal)
              )
            )
          : [];

        if (!this.isCurrent(generation, contextEpoch, abort)) return false;
        const decodedHistory = this.options.getHistory
          ? decodeChatHistoryResponse(history)
          : undefined;
        for (let index = 0; index < runSnapshots.length; index += 1) {
          const runSnapshot = runSnapshots[index];
          if (runSnapshot === undefined) throw new Error("Run snapshot unavailable");
          decodeRunSnapshot(runSnapshot, active[index]?.run_id);
        }
        if (decodedHistory) this.options.onHistorySnapshot?.(decodedHistory);

        const details = await Promise.all(
          active.map((question) =>
            this.options.service.get(
              question.question_id,
              { sessionId: context.sessionId, runId: question.run_id },
              abort.signal
            )
          )
        );
        if (!this.isCurrent(generation, contextEpoch, abort)) return false;

        const liveQuestionIds = new Set<string>();
        details.forEach((detail) => {
          if (detail && isQuestionActiveState(detail.state)) {
            liveQuestionIds.add(detail.question_id);
            if (detail.mutation_token && !useUserQuestionStore.getState().isAccepted(detail.question_id)) {
              this.mutationTokens.set(detail.question_id, detail.mutation_token);
            } else {
              this.mutationTokens.delete(detail.question_id);
            }
          } else if (detail) {
            this.mutationTokens.delete(detail.question_id);
          }
        });
        for (const questionId of this.mutationTokens.keys()) {
          if (!liveQuestionIds.has(questionId)) this.mutationTokens.delete(questionId);
        }
        const replacements = [
          ...metadata.filter((question) => !isQuestionActiveState(question.state)),
          ...details,
        ];
        useUserQuestionStore.getState().replaceSnapshots(generation, replacements);
        useUserQuestionStore.getState().markReady(generation);
        return true;
      } catch (error) {
        if (!this.isCurrent(generation, contextEpoch, abort)) return false;
        if (error instanceof UserQuestionHttpError) {
          if (
            error.kind === "unauthorized" ||
            error.kind === "forbidden" ||
            error.kind === "not_found"
          ) {
            this.clearAfterBoundary(error.kind !== "not_found");
            return false;
          }
          if (error.kind === "aborted" || error.kind === "unavailable") {
            useUserQuestionStore.getState().markOffline(generation);
            return false;
          }
        }
        useUserQuestionStore.getState().markFailed(generation);
        return false;
      } finally {
        if (this.refreshAbort === abort) this.refreshAbort = undefined;
      }
    })();

    this.refreshPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.refreshPromise === promise) this.refreshPromise = undefined;
      if (
        this.refreshQueued &&
        this.context &&
        this.contextEpoch === contextEpoch &&
        !abort.signal.aborted
      ) {
        this.refreshQueued = false;
        void this.refresh();
      }
    }
  }

  private isCurrent(
    generation: number,
    contextEpoch: number,
    abort: AbortController
  ): boolean {
    return (
      generation === this.generation &&
      contextEpoch === this.contextEpoch &&
      !abort.signal.aborted
    );
  }

  private clearAfterBoundary(dropContext: boolean): void {
    const context = dropContext ? undefined : this.context;
    this.mutationTokens.clear();
    this.questionRunIds.clear();
    if (dropContext) this.context = undefined;
    useUserQuestionStore.getState().clearAll("idle");
    if (context) {
      this.generation = useUserQuestionStore.getState().beginGeneration(context);
      useUserQuestionStore.getState().markReady(this.generation);
    } else {
      this.generation = useUserQuestionStore.getState().generation;
    }
  }

  private isCurrentMutation(fence: MutationFence): boolean {
    return (
      fence.generation === this.generation &&
      fence.contextEpoch === this.contextEpoch &&
      fence.questionId.length > 0 &&
      this.context?.sessionId === fence.sessionId &&
      this.activeMutation === fence &&
      !fence.abort.signal.aborted
    );
  }

  private async finishAcceptedMutation(fence: MutationFence): Promise<boolean> {
    if (!this.isCurrentMutation(fence)) return false;
    const { questionId } = fence;
    // A 202 is an accepted mutation, not a terminal transition. Latch the
    // question before refetch so a temporarily stale pending snapshot cannot
    // reopen controls or reuse the mutation proof.
    this.mutationTokens.delete(questionId);
    useUserQuestionStore.getState().latchAccepted(fence.generation, questionId);
    useUserQuestionStore.getState().finishMutation(this.generation, "reconciling");
    const refreshed = await this.refresh();
    if (!this.isCurrentMutation(fence)) return false;
    if (!refreshed) {
      useUserQuestionStore
        .getState()
        .setError(this.generation, "Question state was not confirmed; retry when connected");
      return false;
    }
    const current = useUserQuestionStore.getState().snapshots[questionId];
    if (current && isQuestionActiveState(current.state)) {
      useUserQuestionStore
        .getState()
        .setError(this.generation, "Response accepted; agent is resuming the question");
      return false;
    }
    return true;
  }

  canMutate(questionId: string): boolean {
    return !useUserQuestionStore.getState().isAccepted(questionId) && this.mutationTokens.has(questionId);
  }

  isAccepted(questionId: string): boolean {
    return useUserQuestionStore.getState().isAccepted(questionId);
  }

  onRunFinished(runId?: string): void {
    if (!runId || !this.context || !this.questionRunIds.has(runId)) return;
    if (this.refreshPromise) this.refreshQueued = true;
    void this.refresh();
  }

  async resolve(questionId: string, value: string): Promise<boolean> {
    const state = useUserQuestionStore.getState();
    const question = state.snapshots[questionId];
    const context = this.context;
    const token = this.mutationTokens.get(questionId);
    if (!context || !question || question.state !== "pending" || !token) return false;
    if (!state.beginMutation(this.generation, questionId)) return false;
    const abort = new AbortController();
    const fence: MutationFence = {
      generation: this.generation,
      contextEpoch: this.contextEpoch,
      questionId,
      sessionId: context.sessionId,
      runId: question.run_id,
      abort,
    };
    this.mutationAbort = abort;
    this.activeMutation = fence;
    try {
      await this.options.service.resolve(
        questionId,
        { sessionId: fence.sessionId, runId: fence.runId },
        question.revision,
        token,
        answerForQuestion(question, value),
        abort.signal
      );
      return await this.finishAcceptedMutation(fence);
    } catch (error) {
      return await this.handleMutationError(error, "That response was rejected", fence);
    } finally {
      if (this.mutationAbort === abort) this.mutationAbort = undefined;
      if (this.activeMutation === fence) this.activeMutation = undefined;
    }
  }

  async cancel(questionId: string): Promise<boolean> {
    const state = useUserQuestionStore.getState();
    const question = state.snapshots[questionId];
    const context = this.context;
    const token = this.mutationTokens.get(questionId);
    if (!context || !question || question.state !== "pending" || !token) return false;
    if (!state.beginMutation(this.generation, questionId)) return false;
    const abort = new AbortController();
    const fence: MutationFence = {
      generation: this.generation,
      contextEpoch: this.contextEpoch,
      questionId,
      sessionId: context.sessionId,
      runId: question.run_id,
      abort,
    };
    this.mutationAbort = abort;
    this.activeMutation = fence;
    try {
      await this.options.service.cancel(
        questionId,
        { sessionId: fence.sessionId, runId: fence.runId },
        question.revision,
        token,
        abort.signal
      );
      return await this.finishAcceptedMutation(fence);
    } catch (error) {
      return await this.handleMutationError(error, "Question cancellation was rejected", fence);
    } finally {
      if (this.mutationAbort === abort) this.mutationAbort = undefined;
      if (this.activeMutation === fence) this.activeMutation = undefined;
    }
  }

  private async handleMutationError(
    error: unknown,
    invalidMessage: string,
    fence: MutationFence
  ): Promise<boolean> {
    if (!this.isCurrentMutation(fence)) return false;
    if (error instanceof UserQuestionDecodeError) {
      useUserQuestionStore.getState().finishMutation(fence.generation, "ready");
      useUserQuestionStore.getState().setError(fence.generation, invalidMessage);
      return false;
    }
    if (error instanceof UserQuestionHttpError) {
      if (
        error.kind === "not_found" ||
        error.kind === "unauthorized" ||
        error.kind === "forbidden"
      ) {
        this.clearAfterBoundary(error.kind !== "not_found");
      } else if (error.kind === "conflict") {
        useUserQuestionStore.getState().finishMutation(fence.generation, "reconciling");
        const refreshed = await this.refresh();
        if (refreshed && this.isCurrentMutation(fence)) {
          useUserQuestionStore
            .getState()
            .setError(this.generation, "Question changed or was already answered");
        }
      } else if (error.kind === "invalid") {
        useUserQuestionStore.getState().finishMutation(fence.generation, "ready");
        useUserQuestionStore.getState().setError(fence.generation, invalidMessage);
      } else if (error.kind === "aborted") {
        useUserQuestionStore.getState().finishMutation(fence.generation, "ready");
      } else {
        useUserQuestionStore.getState().finishMutation(fence.generation, "offline");
        useUserQuestionStore.getState().markOffline(fence.generation);
      }
    } else {
      useUserQuestionStore.getState().finishMutation(fence.generation, "offline");
      useUserQuestionStore.getState().markOffline(fence.generation);
    }
    return false;
  }

  dispose(): void {
    this.contextEpoch += 1;
    this.refreshAbort?.abort();
    this.mutationAbort?.abort();
    this.activeMutation = undefined;
    this.mutationTokens.clear();
    this.questionRunIds.clear();
    this.refreshQueued = false;
    this.refreshPromise = undefined;
    this.context = undefined;
    useUserQuestionStore.getState().clearAll("idle");
  }

  getPending(): UserQuestionSnapshot | undefined {
    return pendingQuestionSnapshot(useUserQuestionStore.getState());
  }
}
