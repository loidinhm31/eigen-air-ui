import { afterEach, describe, expect, it, vi } from "vitest";
import { safeRandomUUID } from "./uuid.js";

describe("safeRandomUUID", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers native randomUUID when available", () => {
    const nativeRandomUUID = vi.fn().mockReturnValue("11111111-2222-4333-8444-555555555555");
    const getRandomValues = vi.fn();
    vi.stubGlobal("crypto", {
      randomUUID: nativeRandomUUID,
      getRandomValues,
    });

    const result = safeRandomUUID();
    expect(result).toBe("11111111-2222-4333-8444-555555555555");
    expect(nativeRandomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it("falls back to getRandomValues with RFC 4122 v4 format when randomUUID is unavailable (e.g. Tailscale HTTP)", () => {
    const getRandomValues = vi.fn((buf: Uint8Array) => {
      // Fill with sample bytes: [0, 1, 2, ..., 15]
      for (let i = 0; i < buf.length; i++) {
        buf[i] = i;
      }
      return buf;
    });

    vi.stubGlobal("crypto", {
      getRandomValues,
      // randomUUID is undefined on non-secure contexts
      randomUUID: undefined,
    });

    const result = safeRandomUUID();
    expect(getRandomValues).toHaveBeenCalledOnce();

    // RFC 4122 v4 regex: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx where y is [89ab]
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    // Verify deterministic transformation of [0..15]:
    // byte 6 (originally 0x06): (0x06 & 0x0f) | 0x40 = 0x46
    // byte 8 (originally 0x08): (0x08 & 0x3f) | 0x80 = 0x88
    // hex bytes:
    // 00 01 02 03 - 04 05 - 46 07 - 88 09 - 0a 0b 0c 0d 0e 0f
    expect(result).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });

  it("throws Web Crypto API unavailable when crypto is missing", () => {
    vi.stubGlobal("crypto", undefined);

    expect(() => safeRandomUUID()).toThrow("Web Crypto API unavailable");
  });

  it("throws Web Crypto API unavailable when getRandomValues is not a function", () => {
    vi.stubGlobal("crypto", {
      randomUUID: undefined,
      getRandomValues: undefined,
    });

    expect(() => safeRandomUUID()).toThrow("Web Crypto API unavailable");
  });
});
