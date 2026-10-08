/**
 * Refresh coalescer: at most one run in flight, at most one trailing run, a minimum spacing between
 * run STARTS (the first start is immediate), and a per-run deadline.
 *
 * Run identity: every started run is a `flight`. Only the flight that is still `current` may settle
 * (clear `current`, resolve its waiters, schedule the trailing run). A flight that was retired by
 * the deadline or by `reset()` is inert: its late completion cannot touch a newer run.
 *
 * Deadline = RETIRE the logical run. The owned AbortController is aborted, `current` is released,
 * the run's waiters resolve, `onRetired` fires once, and a pending trailing request starts (subject
 * to spacing). The underlying request may ignore the abort, so a `run` MUST check
 * `signal.aborted` after every await and install nothing when it is set.
 *
 * The same deadline bounds the other network waits through `armDeadline` (abort + expiry hook),
 * `abortable` (stop waiting on an abort-ignoring request) and `createSharedRead` (single-flight
 * read for requests that take no signal, e.g. capabilities).
 */

export const IMAGE_REFRESH_MIN_SPACING_MS = 1000;
export const IMAGE_RUN_DEADLINE_MS = 20_000;

export interface CoalescerDeps {
  now(): number;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Minimum ms between run starts. */
  refreshSpacingMs: number;
  /** Per-run deadline in ms; the run is aborted and retired when it elapses. */
  runDeadlineMs: number;
}

export interface Coalescer {
  /** Fire-and-forget request (hint path; allocates no waiter). */
  request(): void;
  /** Resolves when a run that started after this call has settled, was retired, or after `reset`. */
  requestAndWait(): Promise<void>;
  /** Aborts the in-flight run, drops trailing/timers, resolves every waiter. */
  reset(): void;
}

/**
 * Arms the per-run deadline on `controller`: when `deps().runDeadlineMs` elapses the controller is
 * aborted and then `onExpire` fires. Returns an idempotent disarm that clears the timer. Shared by
 * listing runs, capabilities reads and cancel calls so every network wait is bounded alike.
 */
export function armDeadline(
  deps: CoalescerDeps,
  controller: AbortController,
  onExpire?: () => void
): () => void {
  let handle: { id: unknown } | null = {
    id: deps.setTimer(() => {
      handle = null;
      controller.abort();
      onExpire?.();
    }, deps.runDeadlineMs),
  };
  return () => {
    if (!handle) return;
    deps.clearTimer(handle.id);
    handle = null;
  };
}

/**
 * Resolves with `promise`'s outcome, or with `undefined` as soon as `signal` aborts (the request
 * may ignore the abort; a later settlement of `promise` is swallowed). Callers MUST re-check
 * `signal.aborted` before using the value. (`new Promise`: the package's TS lib predates
 * `Promise.withResolvers`.)
 */
export function abortable<T>(signal: AbortSignal, promise: Promise<T>): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    if (signal.aborted) {
      promise.catch(() => undefined);
      resolve(undefined);
      return;
    }
    const onAbort = (): void => resolve(undefined);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export interface SharedRead {
  /**
   * Joins the in-flight read, or starts a NEW one when none is current. Never rejects: read
   * failure and deadline fail closed (`install(null)` / `onExpire`), retirement installs nothing,
   * and a throwing `install`/`onExpire` is swallowed (see `createSharedRead`).
   */
  join(): Promise<void>;
  /** Frees the share and aborts the run: its late outcome installs nothing. */
  retire(): void;
}

/**
 * Single-flight read bounded by the run deadline, for requests that cannot take a signal (the
 * controller is only the logical-run token). `install` runs only while the run is still
 * authoritative (`null` = the read failed); on expiry the share is freed first, then `onExpire`
 * fires, so a later `join` starts a new request and the retired response changes nothing.
 * Throw hardening: an `install(value)` that throws is retried once as `install(null)` (fail
 * closed); a throw from that retry, from `install(null)` itself or from `onExpire` is swallowed.
 * `join` therefore cannot reject, but the consumer's state after such a throw is only as
 * consistent as its `install` leaves it (`set`-style installs apply the state before notifying,
 * so the retry still lands).
 */
export function createSharedRead<T>(
  deps: () => CoalescerDeps,
  read: () => Promise<T>,
  install: (outcome: { value: T } | null) => void,
  onExpire: () => void
): SharedRead {
  let current: { controller: AbortController; promise: Promise<void>; disarm: () => void } | null =
    null;
  const retire = (): void => {
    const run = current;
    current = null;
    run?.disarm();
    run?.controller.abort();
  };
  const join = (): Promise<void> => {
    if (current) return current.promise;
    const controller = new AbortController();
    const disarm = armDeadline(deps(), controller, () => {
      if (current?.controller !== controller) return;
      current = null;
      try {
        onExpire();
      } catch {
        // runs inside a timer callback: a throwing consumer must not become an uncaught error
      }
    });
    const promise = (async () => {
      let outcome: { value: T } | null = null;
      try {
        const value = await abortable(controller.signal, read());
        outcome = { value: value as T }; // aborted => `undefined`, but then nothing is installed
      } catch {
        // fail closed: `install(null)`
      }
      if (controller.signal.aborted) return;
      try {
        install(outcome);
      } catch {
        // A throwing `install` (e.g. a store subscriber) must not reject `join`. A value outcome
        // is re-installed once as the failure outcome (fail closed); a throwing failure outcome
        // is swallowed (no retry loop) and the consumer's own state stands.
        try {
          if (outcome) install(null);
        } catch {
          // nothing left to do; never reject
        }
      }
    })().finally(() => {
      disarm();
      if (current?.controller === controller) current = null;
    });
    current = { controller, promise, disarm };
    return promise;
  };
  return { join, retire };
}

interface Flight {
  controller: AbortController;
  batch: Array<() => void>;
  disarm: () => void;
}

export function createCoalescer(
  deps: () => CoalescerDeps,
  run: (signal: AbortSignal) => Promise<void>,
  /** Called once when the deadline retires a run (never for reset or normal completion). */
  onRetired?: () => void
): Coalescer {
  let current: Flight | null = null;
  let trailing = false;
  let timer: unknown;
  let hasTimer = false;
  let lastStart = Number.NEGATIVE_INFINITY;
  let waiters: Array<() => void> = [];

  const schedule = (): void => {
    const wait = Math.max(0, lastStart + deps().refreshSpacingMs - deps().now());
    if (wait === 0) {
      start();
      return;
    }
    hasTimer = true;
    timer = deps().setTimer(() => {
      hasTimer = false;
      start();
    }, wait);
  };

  /** Settles `flight` iff it is still the current run; a retired/reset flight is a no-op. */
  const finish = (flight: Flight, retired: boolean): void => {
    if (current !== flight) return;
    current = null;
    flight.disarm();
    try {
      if (retired) onRetired?.(); // the deadline already aborted the controller
    } finally {
      for (const resolve of flight.batch) resolve();
      if (trailing) {
        trailing = false;
        schedule();
      }
    }
  };

  const start = (): void => {
    lastStart = deps().now();
    const controller = new AbortController();
    const flight: Flight = { controller, batch: waiters, disarm: () => undefined };
    waiters = [];
    current = flight;
    flight.disarm = armDeadline(deps(), controller, () => finish(flight, true));
    void run(controller.signal)
      .catch(() => undefined)
      .finally(() => finish(flight, false));
  };

  const request = (): void => {
    if (current) trailing = true;
    else if (!hasTimer) schedule();
  };

  return {
    request,
    requestAndWait: () => {
      const done = new Promise<void>((resolve) => waiters.push(resolve));
      request();
      return done;
    },
    reset: () => {
      if (hasTimer) deps().clearTimer(timer);
      hasTimer = false;
      trailing = false;
      lastStart = Number.NEGATIVE_INFINITY;
      const flight = current;
      current = null;
      flight?.disarm();
      flight?.controller.abort();
      for (const resolve of [...(flight?.batch ?? []), ...waiters]) resolve();
      waiters = [];
    },
  };
}
