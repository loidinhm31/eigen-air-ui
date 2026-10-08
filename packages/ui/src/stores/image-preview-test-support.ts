/**
 * Shared harness for the image preview lifecycle tests: REAL blob cache and REAL image store
 * (stamps driven through setState), fake adapter, fake timers (cache clock = performance.now) and
 * stubbed object URLs / anchor clicks. Call `installImagePreviewFakes()` once per test file.
 */
import { afterEach, beforeEach, expect, vi, type Mock } from "vitest";
import type { ImageArtifactRef } from "@eigen-air-ui/shared/types";
import { setArtifactService, setServiceAccessContext } from "../adapters/factory/ServiceFactory.js";
import type { IArtifactAdapter } from "../adapters/factory/interfaces/IArtifactAdapter.js";
import { disposeArtifactBlobCache, getArtifactBlobCache } from "./artifact-blob-cache.js";
import { useConnectionStore } from "./connectionStore.js";
import { disposeImageArtifactStore, useImageArtifactStore } from "./image-artifact-store.js";
import { disposeImageLeaseDriver } from "./image-lease-driver.js";
import { ImagePreviewError, type ImagePreviewErrorCode } from "./image-preview-loader.js";

export const LEASE_MS = 30_000;

export function makeArtifact(id: string, over: Partial<ImageArtifactRef> = {}): ImageArtifactRef {
  return {
    schema: "image_artifact.v1",
    artifact_id: id,
    job_id: "j1",
    session_id: "s1",
    run_id: "r1",
    ordinal: 0,
    mime: "image/png",
    width: 256,
    height: 256,
    byte_size: 141,
    sha256: "a".repeat(64),
    created_at_ms: 1,
    state: "committed",
    ...over,
  };
}

export const fakeBytes = (size = 141): Blob => ({ size }) as Blob;

export interface ImagePreviewFakes {
  /** `listAllArtifacts` of the fake adapter (reached only with `enableRealImageStore()`). */
  listAll: Mock<(query: unknown, options?: unknown) => Promise<ImageArtifactRef[]>>;
  fetchBytes: Mock<(request: unknown, options?: unknown) => Promise<Blob>>;
  download: Mock<
    (
      request: { artifactId: string },
      options?: unknown
    ) => Promise<{ blob: Blob; filename: string }>
  >;
  /** Replaces `useImageArtifactStore.refreshSession` (unless `enableRealImageStore()` ran). */
  refresh: Mock<(sessionId: string) => Promise<void>>;
  /** Blobs passed to `URL.createObjectURL`, in order (`blob:fake/<n>`). */
  created: Blob[];
  /** URLs passed to `URL.revokeObjectURL`, in order. */
  revoked: string[];
  clicks: Array<{ href: string; download: string }>;
}

/** Stamp a listing of session s1 / run r1 at the cache clock (what the store would record). */
export function stampListing(at: number = getArtifactBlobCache().nowMs()): number {
  useImageArtifactStore.setState({ activeSessionId: "s1", listingStamps: { r1: at } });
  return at;
}

/** The real store action, captured before any test replaces it with `fakes.refresh`. */
const realRefreshSession = useImageArtifactStore.getState().refreshSession;

/**
 * Use the REAL store for this test: real `refreshSession` (listing via `fakes.listAll`, real
 * coalescer, real cache renewal), session `sessionId` active, readers capability known.
 */
export function enableRealImageStore(sessionId = "s1"): void {
  useImageArtifactStore.setState({
    refreshSession: realRefreshSession,
    capabilities: { status: "known", readers: true, generation: false },
  });
  useImageArtifactStore.getState().setActiveSession(sessionId);
}

/** A bytes loader the test completes manually (resolves with a fake blob). */
export function manualLoader(fakes: ImagePreviewFakes): { finish: () => void } {
  let finish = (): void => undefined;
  const promise = new Promise<Blob>((resolve) => {
    finish = () => resolve(fakeBytes());
  });
  fakes.fetchBytes.mockImplementation(() => promise);
  return { finish: () => finish() };
}

/** A download GET (next call only) the test completes manually with a fake attachment. */
export function manualDownload(fakes: ImagePreviewFakes): { finish: () => void } {
  let finish = (): void => undefined;
  // `Promise.withResolvers` is not in this package's TS lib (type-check fails): executor form.
  const promise = new Promise<{ blob: Blob; filename: string }>((resolve) => {
    finish = () => resolve({ blob: fakeBytes(), filename: "a1.png" });
  });
  fakes.download.mockImplementationOnce(() => promise);
  return { finish: () => finish() };
}

export async function codeOf(promise: Promise<unknown>): Promise<ImagePreviewErrorCode> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ImagePreviewError);
    return (e as ImagePreviewError).code;
  }
  throw new Error("expected rejection");
}

export function installImagePreviewFakes(): ImagePreviewFakes {
  const fakes = {} as ImagePreviewFakes;

  beforeEach(() => {
    vi.useFakeTimers();
    disposeImageArtifactStore();
    disposeArtifactBlobCache();
    disposeImageLeaseDriver();
    useConnectionStore.setState({ url: "http://d1", status: "connected" });
    setServiceAccessContext({ authToken: "t1" });

    fakes.created = [];
    fakes.revoked = [];
    fakes.clicks = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      fakes.created.push(blob);
      return `blob:fake/${fakes.created.length}`;
    });
    URL.revokeObjectURL = vi.fn((url: string) => void fakes.revoked.push(url));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      fakes.clicks.push({ href: this.href, download: this.download });
    });

    fakes.refresh = vi.fn(async () => undefined);
    useImageArtifactStore.setState({
      activeSessionId: null,
      listingStamps: {},
      refreshSession: fakes.refresh,
    });
    fakes.listAll = vi.fn(async () => []);
    fakes.fetchBytes = vi.fn(async () => fakeBytes());
    fakes.download = vi.fn(async (req: { artifactId: string }) => ({
      blob: fakeBytes(),
      filename: `${req.artifactId}.png`,
    }));
    setArtifactService({
      listAllArtifacts: fakes.listAll,
      fetchArtifactBytes: fakes.fetchBytes,
      downloadArtifact: fakes.download,
    } as unknown as IArtifactAdapter);
  });

  afterEach(() => {
    disposeImageLeaseDriver();
    disposeImageArtifactStore();
    disposeArtifactBlobCache();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  return fakes;
}
