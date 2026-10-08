/**
 * Image artifact state: capabilities, durable session listing, tracked jobs.
 *
 * Authority rules:
 * - The authorized REST listing/snapshot is the only source of truth. WS hints are refetch
 *   signals and never mutate artifacts/jobs directly.
 * - Every await is fenced by `generation` (bumped on session switch/release and `clear()`) and by
 *   the run's aborted signal (deadline retire; capabilities/cancel/listing alike), so a late
 *   response from an older session/access epoch/run is dropped without touching state.
 * - Listing failures fail closed (never a partial list). Transient failures keep the last list
 *   and never renew preview leases.
 * - Capabilities: unknown stays unavailable, never permission. A failed/hung read (or readers off)
 *   drops the loaded history. `refreshSession` with non-`known` capabilities first runs ONE new
 *   shared read (deadline-bounded, fenced by generation + `invalidationEpoch`); only readers
 *   `true` leads to a fresh complete listing, which alone restores artifacts and lease stamps.
 *   No automatic retry: recovery needs an explicit refresh.
 * - Memory only: nothing here touches localStorage/sessionStorage.
 * - Server ids (`run_id`, `job_id`) are untrusted keys: records are null-prototype and read via
 *   `ownValue`.
 *
 * Slice C consumer notes (binding):
 * - Singleton, ONE active session. Exactly one `useImageHistorySync` owner may be mounted at a
 *   time; a second consumer with another id would steal `activeSessionId`. Releasing the session
 *   (`setActiveSession(null)`) stops pollers/timers, aborts runs, drops artifacts/jobs/stamps and
 *   invalidates the blob-cache scope of the previous session.
 * - No retry storms: a view must NOT loop on `authorization_stale`. The loader already triggers
 *   one coalesced refresh; wait for `listingStamps`/`status` to change, then retry once.
 * - While `status === "idle"` (after invalidation, session switch or release) render LOADING, not
 *   an empty "no images" state. `unavailable` means readers off or access denied; `stale` means
 *   a transient failure (or a retired hung request) kept the last list.
 * - `lastError` is shared by listing and job failures (last writer wins).
 *
 * Services come from `ServiceFactory` at call time; clock/timers/cache are overridable via
 * `configureImageArtifactStore`. Deadlines/coalescing: `image-refresh-coalescer.ts`; jobs:
 * `image-job-tracker.ts`.
 */
import { create } from "zustand";
import {
  imageGenerationAvailable,
  imageReadersAvailable,
  type ImageArtifactRef,
  type ImageJobSnapshot,
} from "@eigen-air-ui/shared/types";
import {
  getArtifactService,
  getConfigService,
  registerAccessInvalidationListener,
} from "../adapters/factory/ServiceFactory.js";
import type { ArtifactAdapterErrorKind } from "../adapters/factory/interfaces/IArtifactAdapter.js";
import type { ImageHintSignal } from "../adapters/factory/interfaces/IChatService.js";
import { getArtifactBlobCache, type ArtifactBlobCache } from "./artifact-blob-cache.js";
import { useConnectionStore } from "./connectionStore.js";
import {
  IMAGE_JOB_POLL_MS,
  createImageJobTracker,
  emptyRecord,
  isDeniedKind,
  isTransientKind,
  kindOf,
  ownValue,
  type ImageJobSelector,
  type ImageJobTracker,
  type JobTrackerDeps,
  type SafeRecord,
} from "./image-job-tracker.js";
import {
  IMAGE_REFRESH_MIN_SPACING_MS,
  IMAGE_RUN_DEADLINE_MS,
  createCoalescer,
  createSharedRead,
  type SharedRead,
  type Coalescer,
} from "./image-refresh-coalescer.js";
import { reconcileImageListing } from "./image-run-groups.js";

export { IMAGE_JOB_POLL_MS, IMAGE_REFRESH_MIN_SPACING_MS, IMAGE_RUN_DEADLINE_MS };
export type { ImageJobSelector };

export type ImageStoreStatus = "idle" | "loading" | "ready" | "stale" | "unavailable" | "error";
export interface ImageCapabilities {
  status: "unknown" | "known";
  readers: boolean;
  generation: boolean;
}

export interface ImageArtifactStore {
  capabilities: ImageCapabilities;
  activeSessionId: string | null;
  status: ImageStoreStatus;
  artifacts: readonly ImageArtifactRef[];
  /** Tracked jobs only (created/cancelled here), keyed by job_id. Terminal jobs stay until clear. */
  jobs: SafeRecord<ImageJobSnapshot>;
  /** runId -> cache-clock ms of the listing that included that run (active session only). */
  listingStamps: SafeRecord<number>;
  /** Monotonic fence: bumped on session switch/release and `clear()`. */
  generation: number;
  /** Bumped on access invalidation / daemon URL change / disconnect; hooks re-subscribe on change. */
  invalidationEpoch: number;
  /** Safe error kind only; never raw error text. Cleared by the next successful listing. */
  lastError?: ArtifactAdapterErrorKind;
  /** `null` releases the session: stops all work and drops its memory (see header notes). */
  setActiveSession(sessionId: string | null): void;
  /** One shared, deadline-bounded read; failure/expiry = unknown (fail closed, see header). */
  refreshCapabilities(): Promise<void>;
  /**
   * Listing refresh; non-`known` capabilities are re-read once first (unknown/no readers after
   * that: `unavailable`). Resolves after a listing started after this call (or when dropped).
   */
  refreshSession(sessionId: string): Promise<void>;
  /** Own lookup only: `undefined` for unknown ids, never an inherited member. */
  listingStampFor(sessionId: string, runId: string): number | undefined;
  trackJob(snapshot: ImageJobSnapshot): void;
  refreshJob(selector: ImageJobSelector): Promise<void>;
  /** Failed cancels set only `lastError`; the job is dropped only on unauthorized/not_found. */
  cancelJob(jobId: string): Promise<void>;
  /** Never throws. */
  handleHint(signal: ImageHintSignal): void;
  /** Drops listing/jobs/stamps for the active session (session id kept). Capabilities untouched. */
  clear(): void;
  /**
   * Retires any in-flight listing run of the active session (late response installs/renews
   * nothing) WITHOUT clearing artifacts; a pure `loading` state returns to `idle`. A fresh listing
   * may start immediately. For the OS-suspend guard, before any refresh.
   */
  retireInFlightListing(): void;
  /** Drops every listing stamp (artifacts kept): previews then need a fresh authorization. */
  resetListingStamps(): void;
}

export interface ImageStoreDeps extends JobTrackerDeps {
  cache(): Pick<ArtifactBlobCache, "nowMs" | "renew" | "invalidateScope">;
}

const defaultDeps = (): ImageStoreDeps => ({
  now: () => performance.now(),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (handle) => clearTimeout(handle as number),
  cache: () => getArtifactBlobCache(),
  refreshSpacingMs: IMAGE_REFRESH_MIN_SPACING_MS,
  runDeadlineMs: IMAGE_RUN_DEADLINE_MS,
  jobPollMs: IMAGE_JOB_POLL_MS,
});

const UNKNOWN_CAPS: ImageCapabilities = { status: "unknown", readers: false, generation: false };

// --- Module runtime (non-reactive bookkeeping) ---

const rt = {
  deps: defaultDeps(),
  subscriptions: null as Array<() => void> | null,
  caps: null as unknown as SharedRead,
  listing: null as unknown as Coalescer,
  tracker: null as unknown as ImageJobTracker,
};
const deps = (): ImageStoreDeps => rt.deps;

/** Session-scoped state: what a switch/release/clear/wipe resets. */
const emptySession = () => ({
  status: "idle" as ImageStoreStatus,
  artifacts: [] as readonly ImageArtifactRef[],
  jobs: emptyRecord<ImageJobSnapshot>(),
  listingStamps: emptyRecord<number>(),
  lastError: undefined as ArtifactAdapterErrorKind | undefined,
});

const initialState = () => ({
  ...emptySession(),
  capabilities: UNKNOWN_CAPS,
  activeSessionId: null as string | null,
  generation: 0,
  invalidationEpoch: 0,
});

export const useImageArtifactStore = create<ImageArtifactStore>((set, get) => {
  const fenced = (gen: number): boolean => get().generation !== gen;

  const resetRuntime = (): void => {
    rt.listing.reset();
    rt.tracker.reset();
  };

  /** Fail-closed listing wipe; `dropJobs` also releases tracked jobs and their pollers. */
  const wipe = (
    status: ImageStoreStatus,
    lastError: ArtifactAdapterErrorKind | undefined,
    dropJobs: boolean
  ): void => {
    if (dropJobs) rt.tracker.reset();
    const { jobs, artifacts, listingStamps } = emptySession();
    set({ status, lastError, artifacts, listingStamps, ...(dropJobs ? { jobs } : {}) });
  };

  /** Fail-closed listing wipe: session bytes/leases dropped, status `unavailable`. */
  const closeListing = (sessionId: string): void => {
    deps().cache().invalidateScope({ sessionId });
    wipe("unavailable", undefined, false);
  };

  async function runListing(signal: AbortSignal): Promise<void> {
    const { activeSessionId: sessionId, generation: gen, capabilities } = get();
    if (sessionId === null) return;
    const cache = deps().cache();
    if (!capabilities.readers) return closeListing(sessionId);
    const stamp = cache.nowMs(); // BEFORE the request: conservative lease anchor.
    const status = get().status;
    if (status !== "ready" && status !== "stale") set({ status: "loading" });
    try {
      const items = await getArtifactService().listAllArtifacts({ sessionId }, { signal });
      if (fenced(gen) || signal.aborted) return; // session change, or run retired by the deadline
      const { artifacts, stamps } = reconcileImageListing(
        cache,
        sessionId,
        get().artifacts,
        items,
        stamp
      );
      set({ status: "ready", artifacts, listingStamps: stamps, lastError: undefined });
    } catch (err) {
      if (fenced(gen) || signal.aborted) return;
      const kind = kindOf(err);
      if (isTransientKind(kind)) {
        set({ status: "stale", lastError: kind }); // keep last list, never renew
        return;
      }
      cache.invalidateScope({ sessionId });
      wipe(isDeniedKind(kind) ? "unavailable" : "error", kind, isDeniedKind(kind));
    }
  }

  const invalidateAll = (): void => {
    rt.caps.retire();
    get().clear();
    set((s) => ({ capabilities: UNKNOWN_CAPS, invalidationEpoch: s.invalidationEpoch + 1 }));
  };

  /** Lazy, once: access invalidation + connection url/disconnect => clear + capabilities unknown. */
  const ensureSubscribed = (): void => {
    if (rt.subscriptions) return;
    rt.subscriptions = [
      registerAccessInvalidationListener(invalidateAll),
      useConnectionStore.subscribe((next, prev) => {
        if (next.url !== prev.url || (prev.status === "connected" && next.status !== "connected"))
          invalidateAll();
      }),
    ];
  };

  /**
   * Losing readers (failed/expired read, readers off) fails the listing closed at once (run
   * retired, artifacts/stamps/leases dropped); only a new read plus a fresh listing restores it.
   */
  const applyCapabilities = (next: ImageCapabilities): void => {
    const lostReaders = get().capabilities.readers && !next.readers;
    try {
      set({ capabilities: next });
    } finally {
      const sessionId = get().activeSessionId;
      if (lostReaders && sessionId !== null) {
        rt.listing.reset();
        closeListing(sessionId);
      }
    }
  };

  // A listing that hits the deadline is a transient abort: keep the last list, never renew.
  rt.listing = createCoalescer(deps, runListing, () =>
    set({ status: "stale", lastError: "aborted" })
  );
  // Fail closed (unknown/false) on failure or deadline; independent of chat provider readiness.
  // `getConfig` takes no signal: a retired read is only a logical run, its late response is inert.
  rt.caps = createSharedRead(
    deps,
    () => getConfigService().getConfig(),
    (config) =>
      applyCapabilities(
        config
          ? {
              status: "known",
              readers: imageReadersAvailable(config.value?.capabilities),
              generation: imageGenerationAvailable(config.value?.capabilities),
            }
          : UNKNOWN_CAPS
      ),
    () => applyCapabilities(UNKNOWN_CAPS)
  );
  rt.tracker = createImageJobTracker({
    deps,
    jobs: () => get().jobs,
    setJobs: (jobs) => set({ jobs }),
    setLastError: (lastError) => set({ lastError }),
    generation: () => get().generation,
    activeSessionId: () => get().activeSessionId,
    onTerminal: (sessionId) => void get().refreshSession(sessionId),
  });

  return {
    ...initialState(),

    setActiveSession: (sessionId) => {
      ensureSubscribed();
      const previous = get().activeSessionId;
      if (sessionId === previous) return;
      resetRuntime();
      if (previous !== null) deps().cache().invalidateScope({ sessionId: previous });
      set((s) => ({ ...emptySession(), activeSessionId: sessionId, generation: s.generation + 1 }));
    },

    refreshCapabilities: () => {
      ensureSubscribed();
      return rt.caps.join();
    },

    refreshSession: async (sessionId) => {
      ensureSubscribed();
      if (get().activeSessionId !== sessionId) return;
      if (get().capabilities.status !== "known") {
        // Recovery point: ONE new shared read. A session switch/invalidation meanwhile drops this
        // refresh; `runListing` then lists (readers true) or fails closed (anything else).
        const { generation: gen, invalidationEpoch: epoch } = get();
        await get().refreshCapabilities();
        const now = get();
        if (fenced(gen) || now.invalidationEpoch !== epoch || now.activeSessionId !== sessionId)
          return;
      }
      return rt.listing.requestAndWait();
    },

    listingStampFor: (sessionId, runId) =>
      get().activeSessionId === sessionId ? ownValue(get().listingStamps, runId) : undefined,

    trackJob: (snapshot) => {
      ensureSubscribed();
      rt.tracker.track(snapshot);
    },

    refreshJob: (selector) => {
      ensureSubscribed();
      return rt.tracker.refresh(selector);
    },

    cancelJob: (jobId) => {
      ensureSubscribed();
      return rt.tracker.cancel(jobId);
    },

    handleHint: (signal) => {
      try {
        ensureSubscribed();
        const state = get();
        if (state.activeSessionId === null) return;
        const hint = signal as Partial<{
          event: unknown;
          session_id: unknown;
          payload: { job_id?: unknown } | null;
        }> | null;
        const valid =
          typeof hint === "object" &&
          hint !== null &&
          (hint.event === "image_job.updated" || hint.event === "image_artifact.committed") &&
          typeof hint.session_id === "string";
        if (valid && hint.session_id !== state.activeSessionId) return; // cross-session hints ignored
        if (valid && hint.event === "image_job.updated") rt.tracker.hint(hint.payload?.job_id);
        if (state.capabilities.readers) rt.listing.request(); // invalid/malformed signals refetch too
      } catch {
        // A hint handler must never throw into the WS dispatch path.
      }
    },

    retireInFlightListing: () => {
      rt.listing.reset();
      if (get().status === "loading") set({ status: "idle" }); // nothing is loading any more
    },

    resetListingStamps: () => set({ listingStamps: emptyRecord<number>() }),

    clear: () => {
      resetRuntime();
      const sessionId = get().activeSessionId;
      if (sessionId !== null) deps().cache().invalidateScope({ sessionId });
      set((s) => ({ ...emptySession(), generation: s.generation + 1 }));
    },
  };
});

/** Test seam: override clock/timers/cache/spacing/deadline. Pass nothing to restore defaults. */
export function configureImageArtifactStore(overrides?: Partial<ImageStoreDeps>): void {
  rt.deps = { ...defaultDeps(), ...overrides };
}

/** Test/teardown: unsubscribe auto-invalidation, cancel all work, reset state and deps. */
export function disposeImageArtifactStore(): void {
  for (const unsubscribe of rt.subscriptions ?? []) unsubscribe();
  rt.subscriptions = null;
  rt.caps.retire();
  const generation = useImageArtifactStore.getState().generation;
  rt.listing.reset();
  rt.tracker.reset();
  useImageArtifactStore.setState({ ...initialState(), generation: generation + 1 });
  rt.deps = defaultDeps();
}
