import {
  type ToolApprovalResolveDecision,
  type ToolApprovalSnapshot,
  type ToolApprovalUpdatedEvent,
  ToolApprovalDecodeError,
} from "@nonclaw-ui/shared/types";
import type { IToolApprovalService } from "../../adapters/factory/interfaces/IToolApprovalService.js";
import { ToolApprovalHttpError } from "../../adapters/http/HttpToolApprovalAdapter.js";
import {
  pendingApprovalSnapshot,
  useToolApprovalStore,
  type ToolApprovalContext,
} from "../../stores/toolApprovalStore.js";

export interface ToolApprovalControllerOptions {
  service: IToolApprovalService;
}

interface MutationFence {
  generation: number;
  contextEpoch: number;
  approvalId: string;
  sessionId: string;
  runId: string;
  abort: AbortController;
}

const MAX_TIMER_DELAY_MS = 2_147_483_647; // 32-bit signed int max
const EXPIRED_BACKOFF_MS = 5000;

export class ToolApprovalController {
  private context?: ToolApprovalContext;
  private generation = 0;
  private contextEpoch = 0;
  private connectionStatus: "connected" | "connecting" | "disconnected" = "connected";
  private refreshPromise?: Promise<boolean>;
  private refreshQueued = false;
  private refreshAbort?: AbortController;
  private detailAbort?: AbortController;
  private mutationAbort?: AbortController;
  private activeMutation?: MutationFence;
  private expiryTimer: number | null = null;
  private lastExpiryRefetchedRevision: Record<string, number> = {};

  constructor(private readonly options: ToolApprovalControllerOptions) {}

  setContext(context: ToolApprovalContext | undefined): void {
    const previous = this.context;
    if (
      context &&
      previous &&
      context.daemonUrl === previous.daemonUrl &&
      context.sessionId === previous.sessionId &&
      context.runId === previous.runId &&
      context.identityKey === previous.identityKey &&
      context.accessRevision === previous.accessRevision
    ) {
      return;
    }

    this.contextEpoch += 1;
    this.refreshAbort?.abort();
    this.detailAbort?.abort();
    this.mutationAbort?.abort();
    this.activeMutation = undefined;
    this.refreshQueued = false;
    this.refreshPromise = undefined;
    this.refreshAbort = undefined;
    this.detailAbort = undefined;
    this.clearExpiryTimer();
    this.lastExpiryRefetchedRevision = {};
    this.context = context;

    if (!context) {
      this.generation = useToolApprovalStore.getState().generation;
      useToolApprovalStore.getState().clearAll("idle");
      return;
    }

    this.generation = useToolApprovalStore.getState().beginGeneration(context);
    void this.refresh();
  }

  onConnectionStatus(status: "connected" | "connecting" | "disconnected"): void {
    this.connectionStatus = status;
    if (!this.context) return;
    if (status === "connected") {
      void this.refresh();
    } else {
      useToolApprovalStore.getState().markOffline(this.generation);
    }
  }

  onApprovalHint(event?: ToolApprovalUpdatedEvent): void {
    if (!this.context) {
      return;
    }

    if (this.refreshPromise) {
      this.refreshQueued = true;
    }

    useToolApprovalStore.getState().recordApprovalHint(this.generation, event);

    if (event?.payload.approval_id) {
      void this.fetchDetail(event.payload.approval_id);
    } else {
      void this.refresh();
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
    this.clearExpiryTimer();
    this.lastExpiryRefetchedRevision = {};
    if (dropContext) this.context = undefined;
    useToolApprovalStore.getState().clearAll("idle");
    if (context) {
      this.generation = useToolApprovalStore.getState().beginGeneration(context);
      if (this.connectionStatus === "connected") {
        useToolApprovalStore.getState().markReady(this.generation);
      } else {
        useToolApprovalStore.getState().markOffline(this.generation);
      }
    } else {
      this.generation = useToolApprovalStore.getState().generation;
    }
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  private scheduleExpiryRefetch(snapshot?: ToolApprovalSnapshot): void {
    this.clearExpiryTimer();
    if (!snapshot || snapshot.state !== "pending" || !snapshot.expires_at_ms) return;
    const now = Date.now();
    let delay = snapshot.expires_at_ms - now;

    if (delay <= 0) {
      // If we already refetched this exact revision after it expired, back off to avoid 0ms loops
      const lastRefetched = this.lastExpiryRefetchedRevision[snapshot.approval_id];
      if (lastRefetched === snapshot.revision) {
        delay = EXPIRED_BACKOFF_MS;
      } else {
        this.lastExpiryRefetchedRevision[snapshot.approval_id] = snapshot.revision;
        delay = 0;
      }
    }

    const clampedDelay = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, delay));
    this.expiryTimer = Number(
      setTimeout(() => {
        if (this.context) {
          void this.refresh();
        }
      }, clampedDelay)
    );
  }

  async refresh(): Promise<boolean> {
    if (!this.context) return false;
    if (this.refreshPromise) return this.refreshPromise;

    const generation = this.generation;
    const context = this.context;
    const contextEpoch = this.contextEpoch;
    const abort = new AbortController();
    this.refreshAbort = abort;
    useToolApprovalStore.getState().beginRefresh(generation);

    const promise = (async (): Promise<boolean> => {
      try {
        const list = await this.options.service.list(
          { sessionId: context.sessionId, runId: context.runId, limit: 100 },
          abort.signal
        );

        if (!this.isCurrent(generation, contextEpoch, abort)) return false;

        useToolApprovalStore.getState().replaceSnapshots(generation, list.approvals);
        if (this.connectionStatus === "connected") {
          useToolApprovalStore.getState().markReady(generation);
        } else {
          useToolApprovalStore.getState().markOffline(generation);
        }
        this.scheduleExpiryRefetch(this.getPending());
        return true;
      } catch (error) {
        if (!this.isCurrent(generation, contextEpoch, abort)) return false;

        if (error instanceof ToolApprovalHttpError) {
          if (error.kind === "unauthorized" || error.kind === "forbidden") {
            this.clearAfterBoundary(true);
            return false;
          }
          if (error.kind === "not_found") {
            this.clearAfterBoundary(false);
            return false;
          }
          if (error.kind === "aborted" || error.kind === "unavailable") {
            useToolApprovalStore.getState().markOffline(generation);
            return false;
          }
        }
        useToolApprovalStore.getState().markFailed(generation);
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

  private async fetchDetail(approvalId: string): Promise<boolean> {
    if (!this.context) return false;
    const generation = this.generation;
    const context = this.context;
    const contextEpoch = this.contextEpoch;
    const abort = new AbortController();
    this.detailAbort?.abort();
    this.detailAbort = abort;

    try {
      const snapshot = await this.options.service.get(
        approvalId,
        { sessionId: context.sessionId, runId: context.runId },
        abort.signal
      );

      if (!this.isCurrent(generation, contextEpoch, abort)) return false;

      const accepted = useToolApprovalStore.getState().replaceSnapshot(generation, snapshot);
      if (accepted) {
        if (this.connectionStatus === "connected") {
          useToolApprovalStore.getState().markReady(generation);
        } else {
          useToolApprovalStore.getState().markOffline(generation);
        }
        this.scheduleExpiryRefetch(this.getPending());
      }
      return accepted;
    } catch (error) {
      if (!this.isCurrent(generation, contextEpoch, abort)) return false;

      if (error instanceof ToolApprovalHttpError) {
        if (error.kind === "not_found") {
          useToolApprovalStore.getState().clearApproval(generation, approvalId);
          if (this.connectionStatus === "connected") {
            useToolApprovalStore.getState().markReady(generation);
          } else {
            useToolApprovalStore.getState().markOffline(generation);
          }
          return false;
        }
        if (error.kind === "unauthorized" || error.kind === "forbidden") {
          this.clearAfterBoundary(true);
          return false;
        }
      }

      // Safe settlement on network / 503 / decode failure
      if (this.connectionStatus !== "connected") {
        useToolApprovalStore.getState().markOffline(generation);
      } else {
        useToolApprovalStore.getState().markReady(generation);
        useToolApprovalStore
          .getState()
          .setError(generation, "Approval service unavailable; try again");
      }
      return false;
    } finally {
      if (this.detailAbort === abort) this.detailAbort = undefined;
    }
  }

  private isCurrentMutation(fence: MutationFence): boolean {
    return (
      fence.generation === this.generation &&
      fence.contextEpoch === this.contextEpoch &&
      fence.approvalId.length > 0 &&
      this.context?.sessionId === fence.sessionId &&
      this.context?.runId === fence.runId &&
      this.activeMutation === fence &&
      !fence.abort.signal.aborted
    );
  }

  canMutate(approvalId: string): boolean {
    const state = useToolApprovalStore.getState();
    return (
      this.connectionStatus === "connected" &&
      !state.isAccepted(approvalId) &&
      state.disabledApprovalIds[approvalId] !== true &&
      state.mutationApprovalId === undefined &&
      state.status !== "offline" &&
      state.status !== "submitting" &&
      state.status !== "reconciling" &&
      state.snapshots[approvalId]?.state === "pending"
    );
  }

  isAccepted(approvalId: string): boolean {
    return useToolApprovalStore.getState().isAccepted(approvalId);
  }

  async resolve(approvalId: string, decision: ToolApprovalResolveDecision): Promise<boolean> {
    const state = useToolApprovalStore.getState();
    const snapshot = state.snapshots[approvalId];
    const context = this.context;

    if (!context || !snapshot || snapshot.state !== "pending") return false;
    if (!state.beginMutation(this.generation, approvalId)) return false;

    const abort = new AbortController();
    const fence: MutationFence = {
      generation: this.generation,
      contextEpoch: this.contextEpoch,
      approvalId,
      sessionId: context.sessionId,
      runId: snapshot.run_id,
      abort,
    };
    this.mutationAbort = abort;
    this.activeMutation = fence;

    try {
      const resolved = await this.options.service.resolve(
        approvalId,
        { sessionId: fence.sessionId, runId: fence.runId },
        snapshot.revision,
        decision,
        abort.signal
      );

      if (!this.isCurrentMutation(fence)) return false;

      // Validate response strictly against the mutation fence before latching!
      if (
        resolved.approval_id !== fence.approvalId ||
        resolved.session_id !== fence.sessionId ||
        resolved.run_id !== fence.runId ||
        resolved.revision <= snapshot.revision ||
        resolved.state === "pending"
      ) {
        useToolApprovalStore.getState().finishMutation(fence.generation, "reconciling");
        await this.refresh();
        useToolApprovalStore
          .getState()
          .setError(this.generation, "Approval state was not confirmed; retry when connected");
        return false;
      }

      // Invariants satisfied: latch accepted approval and apply authoritative update
      useToolApprovalStore.getState().latchAccepted(fence.generation, approvalId);
      useToolApprovalStore.getState().replaceSnapshot(fence.generation, resolved);
      useToolApprovalStore.getState().finishMutation(this.generation, "reconciling");

      await this.refresh();
      return true;
    } catch (error) {
      return await this.handleMutationError(error, fence);
    } finally {
      if (this.mutationAbort === abort) this.mutationAbort = undefined;
      if (this.activeMutation === fence) this.activeMutation = undefined;
    }
  }

  private async handleMutationError(error: unknown, fence: MutationFence): Promise<boolean> {
    if (!this.isCurrentMutation(fence)) return false;
    const { approvalId } = fence;
    const safeSettleStatus = this.connectionStatus === "connected" ? "ready" : "offline";

    if (error instanceof ToolApprovalDecodeError) {
      useToolApprovalStore.getState().finishMutation(fence.generation, safeSettleStatus);
      useToolApprovalStore.getState().setError(fence.generation, "Approval request was rejected");
      return false;
    }

    if (error instanceof ToolApprovalHttpError) {
      if (error.kind === "conflict") {
        useToolApprovalStore.getState().finishMutation(fence.generation, "reconciling");
        await this.refresh();
        if (this.isCurrentMutation(fence)) {
          useToolApprovalStore
            .getState()
            .setError(this.generation, "Approval changed or was already resolved");
        }
      } else if (error.kind === "not_found") {
        useToolApprovalStore.getState().finishMutation(fence.generation, "reconciling");
        await this.refresh();
        if (this.isCurrentMutation(fence)) {
          const remaining = useToolApprovalStore.getState().snapshots[approvalId];
          if (remaining && remaining.state === "pending") {
            useToolApprovalStore
              .getState()
              .disableApproval(
                this.generation,
                approvalId,
                "Approval resolution unavailable for current credentials"
              );
          } else {
            useToolApprovalStore.getState().clearApproval(this.generation, approvalId);
          }
        }
      } else if (error.kind === "unauthorized" || error.kind === "forbidden") {
        this.clearAfterBoundary(true);
      } else if (error.kind === "invalid") {
        useToolApprovalStore.getState().finishMutation(fence.generation, safeSettleStatus);
        useToolApprovalStore.getState().setError(fence.generation, "Approval request was rejected");
      } else if (error.kind === "aborted") {
        useToolApprovalStore.getState().finishMutation(fence.generation, safeSettleStatus);
      } else {
        useToolApprovalStore.getState().finishMutation(fence.generation, safeSettleStatus);
        useToolApprovalStore
          .getState()
          .setError(fence.generation, "Approval service unavailable; try again");
      }
    } else {
      useToolApprovalStore.getState().finishMutation(fence.generation, safeSettleStatus);
      useToolApprovalStore
        .getState()
        .setError(fence.generation, "Approval service unavailable; try again");
    }
    return false;
  }

  dispose(): void {
    this.contextEpoch += 1;
    this.refreshAbort?.abort();
    this.detailAbort?.abort();
    this.mutationAbort?.abort();
    this.activeMutation = undefined;
    this.clearExpiryTimer();
    this.lastExpiryRefetchedRevision = {};
    this.refreshQueued = false;
    this.refreshPromise = undefined;
    this.context = undefined;
    useToolApprovalStore.getState().clearAll("idle");
  }

  getPending(): ToolApprovalSnapshot | undefined {
    return pendingApprovalSnapshot(useToolApprovalStore.getState());
  }
}
