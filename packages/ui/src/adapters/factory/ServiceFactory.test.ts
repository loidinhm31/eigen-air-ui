// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getPersistenceScope,
  getServiceAccessContext,
  getServiceDeploymentId,
  resetServiceFactoryState,
  setServiceAccessContext,
  setServiceDeploymentId,
  registerAccessInvalidationListener,
} from "./ServiceFactory.js";
import { initServicesForDaemonUrl } from "./init-services.js";

describe("ServiceFactory deployment and access scoping (UI-01)", () => {
  beforeEach(() => {
    resetServiceFactoryState();
  });

  afterEach(() => {
    resetServiceFactoryState();
  });

  it("returns null persistence scope when deployment or access-owner is missing", () => {
    expect(getPersistenceScope()).toBeNull();

    setServiceDeploymentId("http://127.0.0.1:18790");
    // identityKey is still missing
    expect(getPersistenceScope()).toBeNull();

    resetServiceFactoryState();
    setServiceAccessContext({ identityKey: "user-123" });
    // deploymentId is still missing
    expect(getPersistenceScope()).toBeNull();
  });

  it("derives valid persistence scope when both deployment and identityKey are present", () => {
    setServiceDeploymentId("http://127.0.0.1:18790");
    setServiceAccessContext({ identityKey: "user-123" });

    const scope = getPersistenceScope();
    expect(scope).toEqual({
      deploymentId: "http://127.0.0.1:18790",
      identityKey: "user-123",
    });
  });

  it("initServicesForDaemonUrl initializes deployment ID from daemon URL", () => {
    initServicesForDaemonUrl("http://localhost:18790/api/");
    expect(getServiceDeploymentId()).toBe("http://localhost:18790/api");

    setServiceAccessContext({ identityKey: "owner-abc" });
    expect(getPersistenceScope()).toEqual({
      deploymentId: "http://localhost:18790/api",
      identityKey: "owner-abc",
    });
  });

  it("initServicesForDaemonUrl supports explicit deployment ID override", () => {
    initServicesForDaemonUrl("http://localhost:18790", "cluster-east-1");
    expect(getServiceDeploymentId()).toBe("cluster-east-1");

    setServiceAccessContext({ identityKey: "owner-abc" });
    expect(getPersistenceScope()).toEqual({
      deploymentId: "cluster-east-1",
      identityKey: "owner-abc",
    });
  });

  it("isolates persistence scope when switching deployment daemon A to daemon B", () => {
    initServicesForDaemonUrl("http://daemon-a:18790");
    setServiceAccessContext({ identityKey: "same-user" });
    const scopeA = getPersistenceScope();
    expect(scopeA).toEqual({
      deploymentId: "http://daemon-a:18790",
      identityKey: "same-user",
    });

    initServicesForDaemonUrl("http://daemon-b:18790");
    const scopeB = getPersistenceScope();
    expect(scopeB).toEqual({
      deploymentId: "http://daemon-b:18790",
      identityKey: "same-user",
    });

    expect(scopeA).not.toEqual(scopeB);
  });

  it("isolates persistence scope when switching principal access context on same deployment", () => {
    initServicesForDaemonUrl("http://daemon-a:18790");
    setServiceAccessContext({ identityKey: "user-1" });
    const scope1 = getPersistenceScope();

    setServiceAccessContext({ identityKey: "user-2" });
    const scope2 = getPersistenceScope();

    expect(scope1?.identityKey).toBe("user-1");
    expect(scope2?.identityKey).toBe("user-2");
    expect(scope1).not.toEqual(scope2);
  });
  it("W1: setServiceAccessContext notifies listeners when deploymentId changes with unchanged principal", () => {
    let notifiedRevision: number | null = null;
    const unsub = registerAccessInvalidationListener((rev) => {
      notifiedRevision = rev;
    });

    setServiceAccessContext({ identityKey: "user-same", deploymentId: "http://daemon-a:18790" });
    expect(notifiedRevision).toBe(1);

    // Change only deploymentId while keeping identityKey unchanged
    setServiceAccessContext({ identityKey: "user-same", deploymentId: "http://daemon-b:18790" });
    expect(notifiedRevision).toBe(2);

    expect(getPersistenceScope()).toEqual({
      deploymentId: "http://daemon-b:18790",
      identityKey: "user-same",
    });

    unsub();
  });
});
