// @vitest-environment jsdom
/**
 * `useInViewport` plus viewport-gated image previews against the REAL ArtifactBlobCache (fake
 * clock/URL/bytes via the shared preview harness) and a fake IntersectionObserver.
 */
import * as React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getArtifactBlobCache } from "../../stores/artifact-blob-cache.js";
import {
  loadImagePreview,
  setPreviewAdmissionCapacity,
} from "../../stores/image-preview-loader.js";
import {
  installImagePreviewFakes,
  makeArtifact,
  manualLoader,
  stampListing,
} from "../../stores/image-preview-test-support.js";
import type { ImageRunGroup } from "../../stores/image-run-groups.js";
import { ChatImageRunGroup } from "./ChatImageRunGroup.js";
import { useInViewport, type UseInViewportOptions } from "./use-in-viewport.js";

const fakes = installImagePreviewFakes();

class FakeObserver {
  static all: FakeObserver[] = [];
  readonly targets = new Set<Element>();
  disconnected = false;
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly init?: IntersectionObserverInit
  ) {
    FakeObserver.all.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
}

/** Deliver an intersection change for `target` the way the browser would. */
function setIntersecting(target: Element, isIntersecting: boolean) {
  for (const observer of FakeObserver.all) {
    if (!observer.targets.has(target)) continue;
    const entry = { isIntersecting, target } as IntersectionObserverEntry;
    act(() => observer.callback([entry], observer as unknown as IntersectionObserver));
  }
}

beforeEach(() => {
  FakeObserver.all = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setPreviewAdmissionCapacity(undefined);
});

function Probe({ options }: { options?: UseInViewportOptions }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const visible = useInViewport(ref, options);
  return (
    <div ref={ref} data-testid="probe">
      {String(visible)}
    </div>
  );
}

describe("useInViewport", () => {
  it("reports visible from the first render when IntersectionObserver is unavailable", () => {
    expect(typeof IntersectionObserver).toBe("undefined");
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("true");
  });

  it("starts hidden, follows the latest entry, uses a 200px margin and disconnects on unmount", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { unmount } = render(<Probe />);
    const probe = screen.getByTestId("probe");
    expect(probe.textContent).toBe("false");
    expect(FakeObserver.all).toHaveLength(1);
    expect(FakeObserver.all[0]?.init?.rootMargin).toBe("200px");

    setIntersecting(probe, true);
    expect(probe.textContent).toBe("true");
    setIntersecting(probe, false);
    expect(probe.textContent).toBe("false");

    // Several queued entries: the last one is the current state (hidden -> visible here).
    const observer = FakeObserver.all[0]!;
    // Partial entries: the hook reads `isIntersecting` only.
    const queued = [
      { isIntersecting: false, target: probe },
      { isIntersecting: true, target: probe },
    ] as unknown as IntersectionObserverEntry[];
    act(() => observer.callback(queued, observer as unknown as IntersectionObserver));
    expect(probe.textContent).toBe("true");

    unmount();
    expect(observer.disconnected).toBe(true);
  });

  it("does not recreate the observer on re-render and honours an injected factory", () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { rerender } = render(<Probe />);
    rerender(<Probe />);
    rerender(<Probe />);
    expect(FakeObserver.all).toHaveLength(1);
    cleanup();

    const observe = vi.fn();
    const disconnect = vi.fn();
    let report!: (entries: ReadonlyArray<{ isIntersecting: boolean }>) => void;
    const createObserver = vi.fn((onEntries: typeof report, init: { rootMargin: string }) => {
      report = onEntries;
      expect(init.rootMargin).toBe("40px");
      return { observe, disconnect };
    });
    const options: UseInViewportOptions = { rootMargin: "40px", createObserver };
    const { unmount } = render(<Probe options={options} />);
    expect(screen.getByTestId("probe").textContent).toBe("false");
    expect(observe).toHaveBeenCalledWith(screen.getByTestId("probe"));
    act(() => report([{ isIntersecting: true }]));
    expect(screen.getByTestId("probe").textContent).toBe("true");
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("viewport-gated image previews (real ArtifactBlobCache)", () => {
  const TOTAL = 12;

  function gallery(count = TOTAL): ImageRunGroup {
    const items = Array.from({ length: count }, (_, i) =>
      makeArtifact(`a${i + 1}`, { ordinal: i })
    );
    return { runId: "r1", sessionId: "s1", items, jobIds: ["j1"], toolCallIds: [] };
  }

  /** Flush the load → state → effect → load chains (fake timers: no waitFor). */
  async function settle() {
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    }
  }

  const figures = () => screen.getAllByRole("figure");
  const imageCount = () => screen.queryAllByRole("img").length;
  const hasImage = (n: number) =>
    screen.queryByRole("img", { name: new RegExp(`^Generated image ${n} of \\d+$`) }) !== null;
  async function show(n: number) {
    setIntersecting(figures()[n - 1]!, true);
    await settle();
  }
  async function hide(n: number) {
    setIntersecting(figures()[n - 1]!, false);
    await settle();
  }

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    stampListing();
  });

  it("loads nothing until an attachment becomes visible", async () => {
    render(<ChatImageRunGroup group={gallery()} />);
    await settle();
    expect(fakes.fetchBytes).not.toHaveBeenCalled();
    expect(imageCount()).toBe(0);
    expect(getArtifactBlobCache().getStats().entries).toBe(0);

    await show(1);
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(1);
    expect(hasImage(1)).toBe(true);
  });

  it("scrolling through 12 attachments renders each newly visible one, releases leaving ones and reloads on return", async () => {
    render(<ChatImageRunGroup group={gallery()} />);

    // A window of 3 visible attachments slides over all 12: pinned leases would exceed the 8-entry
    // cache long before the end if leaving attachments kept theirs.
    for (let n = 1; n <= TOTAL; n++) {
      await show(n);
      expect(hasImage(n)).toBe(true);
      if (n > 3) {
        await hide(n - 3);
        expect(hasImage(n - 3)).toBe(false);
      }
      expect(screen.queryByText(/capacity/i)).toBeNull();
    }
    expect(fakes.created).toHaveLength(TOTAL);
    expect(getArtifactBlobCache().getStats().entries).toBeLessThanOrEqual(8);
    expect(fakes.created.length - fakes.revoked.length).toBeLessThanOrEqual(8);

    // Return to the first one: it was evicted meanwhile, so it fetches again and renders.
    await hide(12);
    await hide(11);
    await hide(10);
    const fetchesBefore = fakes.fetchBytes.mock.calls.length;
    await show(1);
    expect(hasImage(1)).toBe(true);
    expect(fakes.fetchBytes.mock.calls.length).toBe(fetchesBefore + 1);

    // The most recent one is still cached (zero refs): re-entry needs no new fetch.
    await show(12);
    expect(hasImage(12)).toBe(true);
    expect(fakes.fetchBytes.mock.calls.length).toBe(fetchesBefore + 1);
  });

  // Regression for the thundering-herd retry starvation: the old code woke EVERY blocked
  // attachment on each release and charged each a retry (budget 2), so with >= 3 blocked the last
  // ones were out of budget while slots were free and stayed on "capacity reached" until Reload.
  // K = loader slots: 4 (injected) with K+3 visible, and the real cache bound 8 with 12 visible.
  it.each([
    { slots: 4, visible: 7 },
    { slots: undefined, visible: 12 },
  ])(
    "slots=$slots, $visible visible: surplus waits queued, then loads one per released slot in order with no Reload and no failure",
    async ({ slots, visible }) => {
      setPreviewAdmissionCapacity(slots);
      const capacity = slots ?? 8;
      const blocked = visible - capacity;
      const queuedNotices = () => screen.queryAllByText(/Preview capacity reached/);
      render(<ChatImageRunGroup group={gallery()} />);
      for (let n = 1; n <= visible; n++) await show(n);

      expect(imageCount()).toBe(capacity);
      expect(queuedNotices()).toHaveLength(blocked);
      expect(screen.queryAllByRole("button", { name: "Reload" })).toHaveLength(0);
      expect(fakes.fetchBytes).toHaveBeenCalledTimes(capacity); // queued ones fetch nothing

      for (let released = 1; released <= blocked; released++) {
        await hide(released);
        expect(hasImage(capacity + released)).toBe(true); // exactly the next one in line
        expect(imageCount()).toBe(capacity);
        expect(queuedNotices()).toHaveLength(blocked - released);
        expect(fakes.fetchBytes).toHaveBeenCalledTimes(capacity + released);
      }
      expect(screen.queryAllByRole("button", { name: "Reload" })).toHaveLength(0);
      expect(screen.queryAllByRole("alert")).toHaveLength(0);
      expect(getArtifactBlobCache().getStats().entries).toBeLessThanOrEqual(8);
    }
  );

  it("a queued preview that scrolls away leaves the line, and re-entering queues it at the back", async () => {
    render(<ChatImageRunGroup group={gallery()} />);
    for (let n = 1; n <= 12; n++) await show(n); // 9..12 queued, in that order
    const queued = () => screen.queryAllByText(/Preview capacity reached/).length;
    expect(queued()).toBe(4);

    await hide(10);
    expect(queued()).toBe(3);
    await show(10); // now behind 9, 11, 12
    expect(queued()).toBe(4);

    for (const [released, expected] of [
      [1, 9],
      [2, 11],
      [3, 12],
      [4, 10],
    ] as const) {
      await hide(released);
      expect(hasImage(expected)).toBe(true);
      expect(imageCount()).toBe(8);
    }
    expect(queued()).toBe(0);
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(12);
  });

  it("unmounting while previews are queued leaves no waiter and no pinned lease behind", async () => {
    const { unmount } = render(<ChatImageRunGroup group={gallery()} />);
    for (let n = 1; n <= 12; n++) await show(n);
    expect(imageCount()).toBe(8);
    unmount();
    await settle();

    // A leaked waiter would be admitted into (and keep) a slot; a leaked lease would pin one.
    const fetchesBefore = fakes.fetchBytes.mock.calls.length;
    const leases = [];
    for (let i = 1; i <= 8; i++) leases.push(await loadImagePreview(makeArtifact(`c${i}`)));
    expect(fakes.fetchBytes.mock.calls.length).toBe(fetchesBefore + 8);
    leases.forEach((lease) => lease.release());
  });

  it("a load that finishes after the attachment left the viewport creates no URL and holds no lease", async () => {
    render(<ChatImageRunGroup group={gallery(2)} />);
    const pending = manualLoader(fakes);
    setIntersecting(figures()[0]!, true);
    await settle();
    expect(fakes.fetchBytes).toHaveBeenCalledTimes(1);
    // The harness mock is untyped (`options?: unknown`); the loader always passes `{ signal }`.
    const fetchOptions = fakes.fetchBytes.mock.calls[0]?.[1] as { signal: AbortSignal };
    const { signal } = fetchOptions;

    setIntersecting(figures()[0]!, false);
    await settle();
    expect(signal.aborted).toBe(true);

    pending.finish();
    await settle();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(fakes.created).toHaveLength(0);
    expect(getArtifactBlobCache().getStats().entries).toBe(0);
  });

  it("unmounting releases every lease (a full pool of other previews can then be acquired)", async () => {
    const { unmount } = render(<ChatImageRunGroup group={gallery()} />);
    for (let n = 1; n <= 8; n++) await show(n);
    expect(imageCount()).toBe(8);
    unmount();

    // Leaked pins would make the 9th..16th acquire fail with capacity.
    const leases = [];
    for (let i = 1; i <= 8; i++) {
      leases.push(await loadImagePreview(makeArtifact(`b${i}`)));
    }
    expect(leases).toHaveLength(8);
    expect(fakes.revoked).toHaveLength(8);
    leases.forEach((lease) => lease.release());
  });

  it("keeps the lease driver running only while a preview is displayable", async () => {
    render(<ChatImageRunGroup group={gallery(2)} />);
    await settle();
    expect(vi.getTimerCount()).toBe(0);

    await show(1);
    expect(hasImage(1)).toBe(true);
    expect(vi.getTimerCount()).toBeGreaterThan(0); // driver interval registered

    await hide(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
