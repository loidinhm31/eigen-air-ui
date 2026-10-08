/** Shared deterministic fixtures for ArtifactBlobCache tests (fake clock, URLs, scope, subscriptions). */
import {
  ArtifactBlobCache,
  type ArtifactBlobAcquireOptions,
  type ArtifactBlobCacheDeps,
  type ArtifactBlobLoader,
  type ArtifactBlobCacheError,
  type ArtifactBlobScope,
  type ConnectionSnapshot,
} from "./artifact-blob-cache.js";

export const MIB = 1024 * 1024;
export const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
export const fakeBlob = (size: number): Blob => ({ size }) as Blob;

export interface Deferred {
  promise: Promise<Blob>;
  resolve: (size: number) => void;
  reject: (error: unknown) => void;
}
export function deferred(): Deferred {
  let resolve!: (size: number) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Blob>((res, rej) => {
    resolve = (size) => res(fakeBlob(size));
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function setup() {
  const clock = { t: 1_000 };
  const current = { daemonUrl: "http://d1", accessEpoch: 1 };
  const created: string[] = [];
  const revoked: string[] = [];
  let accessListener: (() => void) | undefined;
  let connListener: ((n: ConnectionSnapshot, p: ConnectionSnapshot) => void) | undefined;
  let accessOff = 0;
  let connOff = 0;
  // Deterministic manual timers bound to the fake clock (see `advance`).
  const timers = new Map<number, { at: number; fn: () => void }>();
  let timerId = 0;
  const advance = (ms: number) => {
    const target = clock.t + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, v]) => v.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      clock.t = Math.max(clock.t, due[1].at);
      due[1].fn();
    }
    clock.t = target;
  };
  const deps: Partial<ArtifactBlobCacheDeps> = {
    now: () => clock.t,
    setTimer: (fn, ms) => {
      const id = ++timerId;
      timers.set(id, { at: clock.t + ms, fn });
      return id;
    },
    clearTimer: (handle) => void timers.delete(handle as number),
    getCurrentScope: () => ({ ...current }),
    createObjectURL: () => {
      const url = `blob:fake/${created.length + 1}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url) => {
      revoked.push(url);
    },
    subscribeAccessInvalidation: (l) => {
      accessListener = l;
      return () => {
        accessListener = undefined;
        accessOff++;
      };
    },
    subscribeConnection: (l) => {
      connListener = l;
      return () => {
        connListener = undefined;
        connOff++;
      };
    },
  };
  const cache = new ArtifactBlobCache(deps);
  const scope = (artifactId: string, over: Partial<ArtifactBlobScope> = {}): ArtifactBlobScope => ({
    daemonUrl: current.daemonUrl,
    accessEpoch: current.accessEpoch,
    sessionId: "s1",
    runId: "r1",
    artifactId,
    ...over,
  });
  const load = (size: number) => () => Promise.resolve(fakeBlob(size));
  /** Acquire with a listing stamped at the current fake time unless `authorizedAtMs` is given. */
  const acquire = (
    sc: ArtifactBlobScope,
    loader: ArtifactBlobLoader,
    options: Partial<ArtifactBlobAcquireOptions> = {}
  ) => cache.acquire(sc, loader, { authorizedAtMs: clock.t, ...options });
  return {
    cache,
    clock,
    current,
    created,
    revoked,
    scope,
    load,
    acquire,
    advance,
    pendingTimers: () => timers.size,
    fireAccess: () => accessListener?.(),
    fireConn: (next: Partial<ConnectionSnapshot>, prev: Partial<ConnectionSnapshot>) =>
      connListener?.(
        { url: "u", status: "connected", ...next },
        { url: "u", status: "connected", ...prev }
      ),
    offs: () => ({ access: accessOff, conn: connOff }),
  };
}

export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("expected rejection");
}
export const codeOf = (e: unknown) => (e as ArtifactBlobCacheError).code;
