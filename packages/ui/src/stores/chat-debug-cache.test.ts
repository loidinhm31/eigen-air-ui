import { describe, expect, it } from "vitest";
import {
  ChatDebugCache,
  MAX_CACHE_ENTRIES,
  MAX_CACHE_PLAINTEXT_BYTES,
} from "./chat-debug-cache.js";

describe("ChatDebugCache pure LRU unit tests", () => {
  it("V08: enforces MAX_CACHE_ENTRIES (64) using deterministic LRU eviction", () => {
    const cache = new ChatDebugCache();
    const daemon = "http://localhost";
    const epoch = 1;
    const now = 1000;

    for (let i = 1; i <= MAX_CACHE_ENTRIES + 5; i++) {
      cache.put(daemon, epoch, `sess-${i}`, `run-${i}`, {
        status: "ready",
        runId: `run-${i}`,
        provider: "prov",
        expiresAtMs: now + 60000,
        isPartial: false,
        plaintextBytes: 10,
      }, now + i);
    }

    expect(cache.getEntryCount()).toBe(MAX_CACHE_ENTRIES);
    for (let i = 1; i <= 5; i++) {
      expect(cache.get(daemon, epoch, `sess-${i}`, `run-${i}`, now + 100)).toBeUndefined();
    }
    expect(cache.get(daemon, epoch, "sess-69", "run-69", now + 100)).toBeDefined();
  });

  it("V08: enforces MAX_CACHE_PLAINTEXT_BYTES (4 MiB) eviction", () => {
    const cache = new ChatDebugCache();
    const daemon = "http://localhost";
    const epoch = 1;
    const now = 1000;

    const largeBytes = 2.5 * 1024 * 1024;
    cache.put(daemon, epoch, "sess-1", "run-1", {
      status: "ready",
      runId: "run-1",
      provider: "prov",
      expiresAtMs: now + 60000,
      isPartial: false,
      plaintextBytes: largeBytes,
    }, now);

    expect(cache.getTotalPlaintextBytes()).toBe(largeBytes);

    cache.put(daemon, epoch, "sess-2", "run-2", {
      status: "ready",
      runId: "run-2",
      provider: "prov",
      expiresAtMs: now + 60000,
      isPartial: false,
      plaintextBytes: largeBytes,
    }, now + 10);

    expect(cache.getTotalPlaintextBytes()).toBeLessThanOrEqual(MAX_CACHE_PLAINTEXT_BYTES);
    expect(cache.get(daemon, epoch, "sess-1", "run-1", now + 10)).toBeUndefined();
    expect(cache.get(daemon, epoch, "sess-2", "run-2", now + 10)).toBeDefined();
  });

  it("V09: evicts expired entries on read and on evictExpired", () => {
    const cache = new ChatDebugCache();
    const daemon = "http://localhost";
    const epoch = 1;

    cache.put(daemon, epoch, "sess-1", "run-1", {
      status: "ready",
      runId: "run-1",
      provider: "prov",
      expiresAtMs: 2000,
      isPartial: false,
      plaintextBytes: 50,
    }, 1000);

    expect(cache.get(daemon, epoch, "sess-1", "run-1", 1500)).toBeDefined();
    expect(cache.get(daemon, epoch, "sess-1", "run-1", 2001)).toBeUndefined();
  });
});
