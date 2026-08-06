import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "@nonclaw-ui/shared/constants";

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe("useDebugSettingsStore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("localStorage", new MemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists toggles to localStorage", async () => {
    const { useDebugSettingsStore } = await import("./debugSettingsStore.js");

    useDebugSettingsStore.getState().setShowPromptDebug(true);
    useDebugSettingsStore.getState().setShowReasoningDebug(true);

    expect(useDebugSettingsStore.getState().showPromptDebug).toBe(true);
    expect(useDebugSettingsStore.getState().showReasoningDebug).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.DEBUG_SETTINGS)).toContain(
      '"showPromptDebug":true'
    );
    expect(localStorage.getItem(STORAGE_KEYS.DEBUG_SETTINGS)).toContain(
      '"showReasoningDebug":true'
    );
  });
});
