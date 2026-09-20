// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  saveStoredAuthToken,
  getStoredAuthToken,
  getStoredTokenRetention,
  clearStoredAuthToken,
  computeExpiresAt,
} from "./tokenStorage.js";
import { STORAGE_KEYS } from "@nonclaw-ui/shared/constants";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("tokenStorage", () => {
  it("computes correct expiration timestamps for retention options", () => {
    const baseNow = 1000000;
    expect(computeExpiresAt("session", baseNow)).toBeNull();
    expect(computeExpiresAt("forever", baseNow)).toBeNull();
    expect(computeExpiresAt("1h", baseNow)).toBe(baseNow + 60 * 60 * 1000);
    expect(computeExpiresAt("24h", baseNow)).toBe(baseNow + 24 * 60 * 60 * 1000);
    expect(computeExpiresAt("7d", baseNow)).toBe(baseNow + 7 * 24 * 60 * 60 * 1000);
    expect(computeExpiresAt("30d", baseNow)).toBe(baseNow + 30 * 24 * 60 * 60 * 1000);
  });

  it("saves token to localStorage with 7d retention by default", () => {
    saveStoredAuthToken("test-token-123");
    expect(getStoredAuthToken()).toBe("test-token-123");
    expect(getStoredTokenRetention()).toBe("7d");

    const raw = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!);
    expect(parsed.token).toBe("test-token-123");
    expect(parsed.retention).toBe("7d");
    expect(parsed.expiresAt).toBeGreaterThan(Date.now());
  });

  it("saves session token to sessionStorage and clears from localStorage", () => {
    saveStoredAuthToken("session-token", "session");
    expect(sessionStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeDefined();
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
    expect(getStoredAuthToken()).toBe("session-token");
    expect(getStoredTokenRetention()).toBe("session");
  });

  it("expires timed tokens when now exceeds expiresAt", () => {
    const now = Date.now();
    saveStoredAuthToken("expiring-token", "1h");

    // Valid right now
    expect(getStoredAuthToken(now + 30 * 60 * 1000)).toBe("expiring-token");

    // Expired after 1 hour + 1 second
    expect(getStoredAuthToken(now + 60 * 60 * 1000 + 1000)).toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
  });

  it("clears stored token from both localStorage and sessionStorage", () => {
    saveStoredAuthToken("temp-token");
    expect(getStoredAuthToken()).toBe("temp-token");

    clearStoredAuthToken();
    expect(getStoredAuthToken()).toBeUndefined();
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
  });
});
