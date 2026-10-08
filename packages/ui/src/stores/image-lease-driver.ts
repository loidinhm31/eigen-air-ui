/**
 * Foreground lease driver for image previews.
 *
 * The blob cache is lazy (no internal timer), so while any preview is on screen this driver:
 *   - every <= 15 s: `cache.expireStale()` (always) and, when the document is visible and a
 *     registered preview belongs to the active session, one `refreshSession` listing (the store
 *     coalesces; a successful listing renews the leases it covers);
 *   - on `visibilitychange` (visible) and window `focus`: synchronously `expireStale()` FIRST,
 *     then `refreshSession`, so expired URLs are revoked before any redisplay. The store spaces
 *     listing starts (>= 1 s), so an explicit refresh right after a hint-started listing may be
 *     deferred by up to that spacing; it never extends a lease until its own listing succeeds.
 * Hidden tabs skip network ticks but keep expiring. The interval and listeners exist only while
 * at least one registration is held; with none, the driver does no work at all.
 *
 * Suspend guard: the lease clock is monotonic (`performance.now`), which may stop while the OS
 * sleeps, so a lease can look younger than it is. Between consecutive checkpoints (tick, resume,
 * visibility change) the driver compares wall-clock vs lease-clock deltas; if the wall clock
 * advanced by more than 2 s more than the lease clock, the machine was suspended (or the wall
 * clock jumped forward, which fails closed the same way): any in-flight listing is retired (its
 * late response installs nothing), EVERY cached preview is invalidated and the store's listing
 * stamps are reset, all before any refresh or redisplay. Previews must then be re-acquired from a
 * fresh listing.
 */
import { ARTIFACT_PREVIEW_LEASE_MS, getArtifactBlobCache } from "./artifact-blob-cache.js";
import { useImageArtifactStore } from "./image-artifact-store.js";

/** Half the 30 s lease: one missed tick still leaves a renewal window. */
export const IMAGE_LEASE_DRIVER_INTERVAL_MS = ARTIFACT_PREVIEW_LEASE_MS / 2;
/** Wall-clock advance beyond the lease clock (ms) that is treated as an OS suspension. */
export const IMAGE_LEASE_SUSPEND_GAP_MS = 2_000;

let intervalMs = IMAGE_LEASE_DRIVER_INTERVAL_MS;
let wallClock: () => number = () => Date.now();
/** Registration refcount per session (a preview of that session is on screen). */
const registrations = new Map<string, number>();
let total = 0;
let timer: number | undefined;
/** Bumped by dispose so unregister closures from a previous life can never touch the new one. */
let epoch = 0;
let lastWallMs = 0;
let lastLeaseMs = 0;

/** Test seam: tick interval (clamped to 1..15 000 ms) and wall clock. `dispose` resets both. */
export function configureImageLeaseDriver(options: {
  intervalMs?: number;
  wallClock?: () => number;
}): void {
  if (options.intervalMs !== undefined && Number.isFinite(options.intervalMs)) {
    intervalMs = Math.min(IMAGE_LEASE_DRIVER_INTERVAL_MS, Math.max(1, options.intervalMs));
  }
  if (options.wallClock) wallClock = options.wallClock;
}

function isVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function refreshActiveSession(): void {
  const { activeSessionId, refreshSession } = useImageArtifactStore.getState();
  if (activeSessionId === null || !registrations.has(activeSessionId)) return;
  void refreshSession(activeSessionId);
}

function markClocks(): void {
  lastWallMs = wallClock();
  lastLeaseMs = getArtifactBlobCache().nowMs();
}

/** Suspension check shared by every entry point; MUST run before any expire/refresh/redisplay. */
function guardAgainstSuspension(): void {
  const cache = getArtifactBlobCache();
  const wallDelta = wallClock() - lastWallMs;
  const leaseDelta = cache.nowMs() - lastLeaseMs;
  markClocks();
  if (wallDelta - leaseDelta <= IMAGE_LEASE_SUSPEND_GAP_MS) return;
  // Retire first: a listing authorized before the sleep must not install its pre-sleep stamp or
  // renew leases after this point. Its stamps would look young on the stalled lease clock, so
  // they are dropped too (forces the stale-authorization path); artifacts stay for the relist.
  const store = useImageArtifactStore.getState();
  store.retireInFlightListing();
  cache.invalidateAll();
  store.resetListingStamps();
}

/** Interval tick and focus/visible resume share one order: guard, expire, then (visible) refresh. */
function onResume(): void {
  guardAgainstSuspension();
  getArtifactBlobCache().expireStale();
  if (isVisible()) refreshActiveSession();
}

function onVisibilityChange(): void {
  if (isVisible()) {
    onResume();
  } else {
    guardAgainstSuspension();
    getArtifactBlobCache().expireStale();
  }
}

function start(): void {
  markClocks();
  timer = setInterval(onResume, intervalMs);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  if (typeof window !== "undefined") window.addEventListener("focus", onResume);
}

function stop(): void {
  clearInterval(timer);
  timer = undefined;
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
  if (typeof window !== "undefined") window.removeEventListener("focus", onResume);
}

/**
 * Declare that a preview of `sessionId` is displayed (listings are per session). Returns an
 * idempotent unregister; the last unregister tears down the interval and listeners. An
 * unregister that outlives `disposeImageLeaseDriver` is inert.
 */
export function registerImagePreview(sessionId: string): () => void {
  registrations.set(sessionId, (registrations.get(sessionId) ?? 0) + 1);
  total += 1;
  if (total === 1) start();
  const registeredEpoch = epoch;
  let released = false;
  return () => {
    if (released || registeredEpoch !== epoch) return;
    released = true;
    const left = (registrations.get(sessionId) ?? 1) - 1;
    if (left <= 0) registrations.delete(sessionId);
    else registrations.set(sessionId, left);
    total -= 1;
    if (total === 0) stop();
  };
}

/** Test/teardown: drop every registration, timer and listener; restore default interval/clock. */
export function disposeImageLeaseDriver(): void {
  epoch += 1;
  registrations.clear();
  total = 0;
  stop();
  intervalMs = IMAGE_LEASE_DRIVER_INTERVAL_MS;
  wallClock = () => Date.now();
}
