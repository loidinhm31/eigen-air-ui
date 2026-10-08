import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_RUN_DEADLINE_MS,
  abortable,
  armDeadline,
  createCoalescer,
  createSharedRead,
  type CoalescerDeps,
} from "./image-refresh-coalescer.js";

// --- deterministic harness: fake clock + manual timers + controllable runs ---

const clock = { t: 5000 };
const timers = new Map<number, { at: number; fn: () => void }>();
let timerSeq = 0;
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
async function advance(ms: number): Promise<void> {
  const target = clock.t + ms;
  for (;;) {
    const due = [...timers.entries()]
      .filter(([, v]) => v.at <= target)
      .sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    timers.delete(due[0]);
    clock.t = Math.max(clock.t, due[1].at);
    due[1].fn();
    await flush();
  }
  clock.t = target;
  await flush();
}

const deps: CoalescerDeps = {
  now: () => clock.t,
  setTimer: (fn, ms) => {
    const id = ++timerSeq;
    timers.set(id, { at: clock.t + ms, fn });
    return id;
  },
  clearTimer: (handle) => void timers.delete(handle as number),
  refreshSpacingMs: 1000,
  runDeadlineMs: IMAGE_RUN_DEADLINE_MS,
};

interface Run {
  signal: AbortSignal;
  startedAt: number;
  finish(): void;
  fail(): void;
}
const runs: Run[] = [];
const run = (signal: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    runs.push({ signal, startedAt: clock.t, finish: resolve, fail: () => reject(new Error("x")) });
  });

const make = (onRetired?: () => void) => createCoalescer(() => deps, run, onRetired);

beforeEach(() => {
  clock.t = 5000;
  timers.clear();
  timerSeq = 0;
  runs.length = 0;
  deps.refreshSpacingMs = 1000;
  deps.runDeadlineMs = IMAGE_RUN_DEADLINE_MS;
});

describe("spacing and trailing", () => {
  it("starts the first run immediately and collapses a flood into one trailing run", async () => {
    const c = make();
    for (let i = 0; i < 1000; i++) c.request();
    expect(runs).toHaveLength(1);
    runs[0]!.finish();
    await flush();
    expect(runs).toHaveLength(1); // trailing waits for the 1000 ms spacing
    await advance(999);
    expect(runs).toHaveLength(1);
    await advance(1);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.startedAt - runs[0]!.startedAt).toBe(1000);
    runs[1]!.finish();
    await advance(10_000);
    expect(runs).toHaveLength(2); // the trailing request was consumed exactly once
  });

  it("a request while idle inside the spacing window arms exactly one timer", async () => {
    const c = make();
    c.request();
    runs[0]!.finish();
    await flush();
    await advance(300);
    for (let i = 0; i < 50; i++) c.request();
    expect(timers.size).toBe(1);
    await advance(699);
    expect(runs).toHaveLength(1);
    await advance(1);
    expect(runs).toHaveLength(2);
  });

  it("an explicit waiter right after a start waits for the spacing (pinned behavior)", async () => {
    const c = make();
    c.request();
    runs[0]!.finish();
    await flush();
    await advance(400);
    let done = false;
    void c.requestAndWait().then(() => (done = true));
    await flush();
    expect(runs).toHaveLength(1);
    await advance(599);
    expect(runs).toHaveLength(1);
    await advance(1);
    expect(runs).toHaveLength(2);
    expect(done).toBe(false);
    runs[1]!.finish();
    await flush();
    expect(done).toBe(true);
  });

  it("requestAndWait resolves with a run that started after the call, not the one in flight", async () => {
    const c = make();
    c.request();
    let done = false;
    void c.requestAndWait().then(() => (done = true));
    runs[0]!.finish();
    await flush();
    expect(done).toBe(false);
    await advance(1000);
    expect(runs).toHaveLength(2);
    runs[1]!.finish();
    await flush();
    expect(done).toBe(true);
  });

  it("a rejecting run still settles: waiters resolve and the trailing run proceeds", async () => {
    const c = make();
    c.request();
    const waited = c.requestAndWait();
    runs[0]!.fail();
    await advance(1000);
    expect(runs).toHaveLength(2);
    runs[1]!.finish();
    await expect(waited).resolves.toBeUndefined();
  });
});

describe("reset", () => {
  it("aborts the in-flight run, resolves all waiters, drops trailing and timers", async () => {
    const c = make();
    c.request();
    const first = c.requestAndWait(); // trailing + waiter
    c.reset();
    await expect(first).resolves.toBeUndefined();
    expect(runs[0]!.signal.aborted).toBe(true);
    expect(timers.size).toBe(0); // deadline timer cleared
    runs[0]!.finish();
    await advance(60_000);
    expect(runs).toHaveLength(1); // trailing dropped
  });

  it("zeroes the spacing and keeps a reset run's late completion away from the newer run", async () => {
    const c = make();
    c.request();
    c.reset();
    c.request(); // spacing zeroed: starts immediately
    expect(runs).toHaveLength(2);
    let waited = false;
    void c.requestAndWait().then(() => (waited = true)); // trailing + waiter of run #2
    runs[0]!.finish(); // the reset run lands late
    await flush();
    expect(waited).toBe(false);
    await advance(1000); // a clobbered `current` would start the trailing run while #2 is in flight
    c.request();
    expect(runs).toHaveLength(2); // run #2 is still current: no extra start
    runs[1]!.finish();
    await advance(1000);
    expect(runs).toHaveLength(3); // exactly one trailing
    runs[2]!.finish();
    await flush();
    expect(waited).toBe(true);
  });

  it("clears a pending spacing timer", async () => {
    const c = make();
    c.request();
    runs[0]!.finish();
    await flush();
    c.request();
    expect(timers.size).toBe(1);
    c.reset();
    expect(timers.size).toBe(0);
  });
});

describe("per-run deadline", () => {
  it("defaults to 20 000 ms and does not fire early", async () => {
    expect(IMAGE_RUN_DEADLINE_MS).toBe(20_000);
    const onRetired = vi.fn();
    make(onRetired).request();
    await advance(19_999);
    expect(runs[0]!.signal.aborted).toBe(false);
    expect(onRetired).not.toHaveBeenCalled();
    await advance(1);
    expect(runs[0]!.signal.aborted).toBe(true);
    expect(onRetired).toHaveBeenCalledTimes(1);
  });

  it("retires the run: aborts the owned controller, resolves its waiters, releases `current`", async () => {
    const onRetired = vi.fn();
    const c = make(onRetired);
    const waited = c.requestAndWait();
    await advance(20_000);
    await expect(waited).resolves.toBeUndefined();
    expect(runs[0]!.signal.aborted).toBe(true);
    c.request(); // `current` was released and the spacing elapsed: starts immediately
    expect(runs).toHaveLength(2);
  });

  it("a retired run's late completion cannot clear, resolve or double-trigger a newer run", async () => {
    const c = make();
    c.request();
    c.request(); // trailing pending
    await advance(20_000); // run #1 retired; trailing starts run #2
    expect(runs).toHaveLength(2);
    let waited = false;
    void c.requestAndWait().then(() => (waited = true)); // trailing + waiter, both for run #3
    runs[0]!.finish(); // abort-ignoring request #1 finally lands
    await flush();
    expect(waited).toBe(false);
    expect(runs).toHaveLength(2); // no extra trailing start from the retired run
    await advance(1000);
    c.request();
    expect(runs).toHaveLength(2); // run #2 is still current: no early trailing start
    runs[1]!.finish();
    await advance(1000);
    expect(runs).toHaveLength(3);
    runs[2]!.finish();
    await flush();
    expect(waited).toBe(true);
    await advance(60_000);
    expect(runs).toHaveLength(3);
  });

  it("keeps the spacing after a retirement", async () => {
    deps.refreshSpacingMs = 25_000;
    const c = make();
    c.request();
    c.request(); // trailing
    await advance(20_000);
    expect(runs).toHaveLength(1); // retired, trailing still inside the 25 s spacing
    await advance(4999);
    expect(runs).toHaveLength(1);
    await advance(1);
    expect(runs).toHaveLength(2);
    expect(runs[1]!.startedAt - runs[0]!.startedAt).toBe(25_000);
  });

  it("clears the deadline timer when the run settles", async () => {
    const onRetired = vi.fn();
    const c = make(onRetired);
    c.request();
    expect(timers.size).toBe(1);
    runs[0]!.finish();
    await flush();
    expect(timers.size).toBe(0);
    await advance(60_000);
    expect(onRetired).not.toHaveBeenCalled();
    expect(runs[0]!.signal.aborted).toBe(false);
  });

  it("each run gets its own deadline measured from its own start", async () => {
    const c = make();
    c.request();
    c.request();
    await advance(500);
    runs[0]!.finish();
    await advance(1000); // trailing starts at t=1000 (relative)
    expect(runs).toHaveLength(2);
    await advance(19_999);
    expect(runs[1]!.signal.aborted).toBe(false);
    await advance(1);
    expect(runs[1]!.signal.aborted).toBe(true);
  });

  it("onRetired is not called by reset", async () => {
    const onRetired = vi.fn();
    const c = make(onRetired);
    c.request();
    c.reset();
    await advance(60_000);
    expect(onRetired).not.toHaveBeenCalled();
  });
});

describe("armDeadline / abortable", () => {
  it("aborts then calls onExpire at the deadline; disarm clears the timer and is idempotent", async () => {
    const expired = vi.fn();
    const controller = new AbortController();
    const disarm = armDeadline(deps, controller, expired);
    await advance(19_999);
    expect(controller.signal.aborted).toBe(false);
    await advance(1);
    expect(controller.signal.aborted).toBe(true);
    expect(expired).toHaveBeenCalledTimes(1);
    disarm();

    const other = new AbortController();
    const off = armDeadline(deps, other, expired);
    off();
    off();
    expect(timers.size).toBe(0);
    await advance(60_000);
    expect(other.signal.aborted).toBe(false);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("abortable resolves undefined on abort, passes the outcome through, swallows a late rejection", async () => {
    const controller = new AbortController();
    let reject!: (reason: unknown) => void;
    const hung = new Promise<string>((_, rej) => void (reject = rej));
    const raced = abortable(controller.signal, hung);
    controller.abort();
    expect(await raced).toBeUndefined();
    reject(new Error("late")); // must not surface as an unhandled rejection
    await flush();

    expect(await abortable(new AbortController().signal, Promise.resolve("ok"))).toBe("ok");
    await expect(
      abortable(new AbortController().signal, Promise.reject(new Error("boom")))
    ).rejects.toThrow("boom");
    const aborted = new AbortController();
    aborted.abort();
    expect(await abortable(aborted.signal, Promise.reject(new Error("ignored")))).toBeUndefined();
  });
});

describe("createSharedRead", () => {
  interface Read {
    resolve(value: string): void;
    reject(): void;
  }
  const reads: Read[] = [];
  const read = (): Promise<string> =>
    new Promise<string>((resolve, rej) => {
      reads.push({ resolve, reject: () => rej(new Error("x")) });
    });
  const setup = () => {
    reads.length = 0;
    const installed: Array<{ value: string } | null> = [];
    const onExpire = vi.fn();
    const shared = createSharedRead(
      () => deps,
      read,
      (o) => installed.push(o),
      onExpire
    );
    return { shared, installed, onExpire };
  };

  it("shares one read, installs once, and a later join starts a new read", async () => {
    const { shared, installed } = setup();
    const a = shared.join();
    const b = shared.join();
    expect(reads).toHaveLength(1);
    reads[0]!.resolve("one");
    await Promise.all([a, b]);
    expect(installed).toEqual([{ value: "one" }]);
    expect(timers.size).toBe(0);
    void shared.join();
    expect(reads).toHaveLength(2);
  });

  it("a failure installs null (fail closed)", async () => {
    const { shared, installed } = setup();
    const done = shared.join();
    reads[0]!.reject();
    await done;
    expect(installed).toEqual([null]);
  });

  it("the deadline frees the share, releases joiners and makes the old outcome inert", async () => {
    const { shared, installed, onExpire } = setup();
    let released = false;
    void shared.join().then(() => (released = true));
    await advance(20_000);
    expect(released).toBe(true);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(installed).toEqual([]);

    const retry = shared.join();
    expect(reads).toHaveLength(2);
    reads[1]!.resolve("fresh");
    await retry;
    reads[0]!.resolve("stale"); // retired
    await flush();
    expect(installed).toEqual([{ value: "fresh" }]);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("retire frees the share and the timer without calling onExpire; its outcome is inert", async () => {
    const { shared, installed, onExpire } = setup();
    const done = shared.join();
    shared.retire();
    expect(timers.size).toBe(0);
    await done;
    void shared.join();
    expect(reads).toHaveLength(2);
    reads[0]!.resolve("old");
    await flush();
    expect(installed).toEqual([]);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("a throwing install never rejects join: the failure outcome is installed (fail closed); a second throw is swallowed", async () => {
    reads.length = 0;
    const calls: Array<{ value: string } | null> = [];
    const throwing = createSharedRead(
      () => deps,
      read,
      (o) => {
        calls.push(o);
        if (o) throw new Error("subscriber");
      },
      vi.fn()
    );
    const done = throwing.join();
    reads[0]!.resolve("v");
    await expect(done).resolves.toBeUndefined();
    expect(calls).toEqual([{ value: "v" }, null]); // retried once as the failure outcome

    calls.length = 0;
    const always = createSharedRead(
      () => deps,
      read,
      (o) => {
        calls.push(o);
        throw new Error("always");
      },
      vi.fn()
    );
    const again = always.join();
    reads[1]!.reject();
    await expect(again).resolves.toBeUndefined();
    expect(calls).toEqual([null]); // the failure outcome itself threw: swallowed, no retry loop
    void always.join();
    expect(reads).toHaveLength(3); // the share was freed
    expect(timers.size).toBe(1); // only the new read's deadline
  });

  it("a throwing onExpire stays inside the timer callback and the share is still freed", async () => {
    reads.length = 0;
    const shared = createSharedRead(
      () => deps,
      read,
      () => undefined,
      () => {
        throw new Error("expire");
      }
    );
    const done = shared.join();
    await expect(advance(20_000)).resolves.toBeUndefined();
    await expect(done).resolves.toBeUndefined();
    void shared.join();
    expect(reads).toHaveLength(2);
  });
});
