import type { ChatDebugLoaderResult } from "../adapters/http/chat-debug-loader.js";

export const MAX_CONCURRENT_LOADS = 4;

export interface ActiveLoad {
  abortController: AbortController;
  promise: Promise<ChatDebugLoaderResult>;
  consumerIds: Set<string>;
  accessEpoch: number;
}

export interface QueuedLoad {
  sessionId: string;
  runId: string;
  consumerId: string;
}

export class ChatDebugActiveLoadsManager {
  private readonly active = new Map<string, ActiveLoad>();
  private readonly queue: QueuedLoad[] = [];

  get(displayKey: string): ActiveLoad | undefined {
    return this.active.get(displayKey);
  }

  has(displayKey: string): boolean {
    return this.active.has(displayKey);
  }

  getActiveCount(): number {
    return this.active.size;
  }

  isAtCapacity(): boolean {
    return this.active.size >= MAX_CONCURRENT_LOADS;
  }

  registerActive(
    displayKey: string,
    abortController: AbortController,
    promise: Promise<ChatDebugLoaderResult>,
    consumerId: string,
    accessEpoch: number
  ): void {
    this.active.set(displayKey, {
      abortController,
      promise,
      consumerIds: new Set([consumerId]),
      accessEpoch,
    });
  }

  removeActive(displayKey: string): void {
    this.active.delete(displayKey);
  }

  enqueue(load: QueuedLoad): void {
    this.queue.push(load);
  }

  dequeue(): QueuedLoad | undefined {
    return this.queue.shift();
  }

  hasQueued(): boolean {
    return this.queue.length > 0;
  }
  removeQueued(sessionId: string, runId: string, consumerId: string): boolean {
    const index = this.queue.findIndex(
      (item) => item.sessionId === sessionId && item.runId === runId && item.consumerId === consumerId
    );
    if (index >= 0) {
      this.queue.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Release interest from a consumer.
   * Returns true if the load was aborted because zero consumers remain.
   */
  releaseInterest(displayKey: string, consumerId: string): boolean {
    const existing = this.active.get(displayKey);
    if (!existing) return false;

    existing.consumerIds.delete(consumerId);
    if (existing.consumerIds.size === 0) {
      existing.abortController.abort();
      this.active.delete(displayKey);
      return true;
    }
    return false;
  }

  abortAll(): void {
    for (const load of this.active.values()) {
      load.abortController.abort();
    }
    this.active.clear();
    this.queue.length = 0;
  }
}
