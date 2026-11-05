// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { initServices } from "./init.js";
import {
  getServiceAccessContext,
  setServiceAccessContext,
  saveStoredAuthToken,
  clearStoredAuthToken,
} from "@eigen-air-ui/ui";
import { STORAGE_KEYS } from "@eigen-air-ui/shared/constants";

describe("web initServices", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clearStoredAuthToken();
    setServiceAccessContext({});
  });

  it("leaves fresh storage completely token-free without granting default capabilities", () => {
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();

    initServices();

    expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeNull();
    const access = getServiceAccessContext();
    expect(access.authToken).toBeUndefined();
    expect(access.capabilities).toBeUndefined();
  });

  it("configures access context when a valid token is present in storage", () => {
    saveStoredAuthToken("user-configured-token", "forever");

    initServices();

    const access = getServiceAccessContext();
    expect(access.authToken).toBe("user-configured-token");
    expect(access.capabilities?.has("run:read:debug")).toBe(true);
    expect(access.capabilities?.has("run:export")).toBe(true);
    expect(access.capabilities?.has("run:delete")).toBe(true);
  });
});
