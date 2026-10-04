import type { ChatDebugReadyPayload } from "../adapters/http/chat-debug-projection.js";

export const MAX_CACHE_ENTRIES = 64;
export const MAX_CACHE_PLAINTEXT_BYTES = 4 * 1024 * 1024; // 4 MiB

export interface ChatDebugCacheEntry {
  key: string;
  runId: string;
  sessionId: string;
  data: ChatDebugReadyPayload;
  plaintextBytes: number;
  expiresAtMs: number;
  lastAccessedAtMs: number;
}

export function buildCacheKey(
  daemonUrl: string,
  accessEpoch: number,
  sessionId: string,
  runId: string
): string {
  return `${encodeURIComponent(daemonUrl)}::${accessEpoch}::${encodeURIComponent(sessionId)}::${encodeURIComponent(runId)}`;
}

export class ChatDebugCache {
  private readonly entries = new Map<string, ChatDebugCacheEntry>();
  private totalBytes = 0;

  get(
    daemonUrl: string,
    accessEpoch: number,
    sessionId: string,
    runId: string,
    now: number = Date.now()
  ): ChatDebugReadyPayload | undefined {
    const key = buildCacheKey(daemonUrl, accessEpoch, sessionId, runId);
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (now >= entry.expiresAtMs) {
      this.deleteEntry(key);
      return undefined;
    }

    entry.lastAccessedAtMs = now;
    // Move to end of Map for LRU insertion order
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.data;
  }

  put(
    daemonUrl: string,
    accessEpoch: number,
    sessionId: string,
    runId: string,
    data: ChatDebugReadyPayload,
    now: number = Date.now()
  ): void {
    if (now >= data.expiresAtMs) {
      return;
    }

    const key = buildCacheKey(daemonUrl, accessEpoch, sessionId, runId);
    this.deleteEntry(key);

    const bytes = data.plaintextBytes;
    this.evictToFit(1, bytes);

    const entry: ChatDebugCacheEntry = {
      key,
      runId,
      sessionId,
      data,
      plaintextBytes: bytes,
      expiresAtMs: data.expiresAtMs,
      lastAccessedAtMs: now,
    };

    this.entries.set(key, entry);
    this.totalBytes += bytes;
  }

  private deleteEntry(key: string): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.totalBytes -= existing.plaintextBytes;
      this.entries.delete(key);
    }
  }

  private evictToFit(additionalEntries: number, additionalBytes: number): void {
    while (
      (this.entries.size + additionalEntries > MAX_CACHE_ENTRIES ||
        this.totalBytes + additionalBytes > MAX_CACHE_PLAINTEXT_BYTES) &&
      this.entries.size > 0
    ) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.deleteEntry(oldestKey);
      } else {
        break;
      }
    }
  }

  evictExpired(now: number = Date.now()): number {
    let evictedCount = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (now >= entry.expiresAtMs) {
        this.deleteEntry(key);
        evictedCount += 1;
      }
    }
    return evictedCount;
  }

  evictRun(runId: string): void {
    for (const [key, entry] of this.entries.entries()) {
      if (entry.runId === runId) {
        this.deleteEntry(key);
      }
    }
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  getEarliestExpiry(): number | undefined {
    let earliest: number | undefined = undefined;
    for (const entry of this.entries.values()) {
      if (earliest === undefined || entry.expiresAtMs < earliest) {
        earliest = entry.expiresAtMs;
      }
    }
    return earliest;
  }

  getEntryCount(): number {
    return this.entries.size;
  }

  getTotalPlaintextBytes(): number {
    return this.totalBytes;
  }
}
