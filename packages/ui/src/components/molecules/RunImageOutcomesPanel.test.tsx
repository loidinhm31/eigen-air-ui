// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ImageArtifactRef, ImageJobSnapshot } from "@eigen-air-ui/shared/types";
import {
  disposeImageArtifactStore,
  useImageArtifactStore,
  type ImageCapabilities,
  type ImageStoreStatus,
} from "../../stores/image-artifact-store.js";
import type * as UseImageHistory from "../../stores/use-image-history.js";
import type * as PreviewLoader from "../../stores/image-preview-loader.js";
import { loadImagePreview } from "../../stores/image-preview-loader.js";
import { useImageHistorySync } from "../../stores/use-image-history.js";
import { RunImageOutcomesPanel } from "./RunImageOutcomesPanel.js";

vi.mock("../../stores/use-image-history.js", async (importActual) => ({
  ...(await importActual<typeof UseImageHistory>()),
  useImageHistorySync: vi.fn(),
}));
vi.mock("../../stores/image-preview-loader.js", async (importActual) => ({
  ...(await importActual<typeof PreviewLoader>()),
  loadImagePreview: vi.fn(),
}));
vi.mock("../../stores/image-lease-driver.js", () => ({
  registerImagePreview: vi.fn(() => vi.fn()),
}));
vi.mock("../../stores/image-download.js", () => ({ downloadImageArtifact: vi.fn() }));

const READERS: ImageCapabilities = { status: "known", readers: true, generation: false };

function artifact(id: string, overrides: Partial<ImageArtifactRef> = {}): ImageArtifactRef {
  return {
    schema: "image_artifact.v1",
    artifact_id: id,
    job_id: "job-1",
    session_id: "s1",
    run_id: "r1",
    ordinal: 0,
    mime: "image/png",
    width: 64,
    height: 64,
    byte_size: 100,
    sha256: "0".repeat(64),
    created_at_ms: 1,
    state: "committed",
    ...overrides,
  };
}

function job(overrides: Partial<ImageJobSnapshot> = {}): ImageJobSnapshot {
  return {
    schema: "image_job.v1",
    revision: 1,
    created_at_ms: 1,
    updated_at_ms: 1,
    terminal_at_ms: null,
    job_id: "job-1",
    session_id: "s1",
    run_id: "r1",
    origin: "direct_template",
    template_id: "general-image",
    state: "running",
    requested_count: 2,
    completed_count: 1,
    effective_quality: "balanced",
    effective_width: 1024,
    effective_height: 1024,
    effective_steps: 20,
    effective_backend: "vulkan",
    effective_model_id: "model-a",
    safe_code: null,
    artifacts: [],
    ...overrides,
  };
}

function seed(state: {
  capabilities?: ImageCapabilities;
  status?: ImageStoreStatus;
  artifacts?: ImageArtifactRef[];
  jobs?: ImageJobSnapshot[];
}) {
  useImageArtifactStore.getState().setActiveSession("s1");
  useImageArtifactStore.setState({
    capabilities: state.capabilities ?? READERS,
    status: state.status ?? "ready",
    artifacts: state.artifacts ?? [],
    jobs: Object.fromEntries((state.jobs ?? []).map((j) => [j.job_id, j])),
  });
}

let refreshSession: Mock;
let cancelJob: Mock;

beforeEach(() => {
  vi.mocked(loadImagePreview).mockReturnValue(new Promise(() => undefined));
  refreshSession = vi.fn().mockResolvedValue(undefined);
  cancelJob = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  disposeImageArtifactStore();
  vi.clearAllMocks();
});

function mount() {
  const view = render(<RunImageOutcomesPanel sessionId="s1" runId="r1" />);
  // Replace the actions after the first render so the seeded state is the real store's.
  useImageArtifactStore.setState({ refreshSession, cancelJob });
  return view;
}

describe("RunImageOutcomesPanel", () => {
  it("owns the session sync", () => {
    seed({});
    mount();
    expect(vi.mocked(useImageHistorySync)).toHaveBeenCalledWith("s1");
  });

  it("renders nothing when the readers are not available", () => {
    seed({ capabilities: { status: "known", readers: false, generation: true } });
    const { container } = mount();
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while capabilities are unknown and the read has not failed yet", () => {
    seed({
      capabilities: { status: "unknown", readers: false, generation: false },
      status: "idle",
    });
    const { container } = mount();
    expect(container.firstChild).toBeNull();
  });

  it("shows a fixed 'could not be checked' notice with Check again when the capability read failed", async () => {
    seed({
      capabilities: { status: "unknown", readers: false, generation: false },
      status: "unavailable",
    });
    const user = userEvent.setup();
    mount();
    expect(screen.getByRole("heading", { name: "Image outputs" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Image history could not be checked.");
    expect(screen.queryByText("No images were produced by this run.")).toBeNull();
    const button = screen.getByRole("button", { name: "Check again" });
    expect(button.textContent).not.toMatch(/retry/i);
    await user.click(button);
    expect(refreshSession).toHaveBeenCalledWith("s1");
  });

  it.each(["idle", "loading"] as const)(
    "shows a loading state (not 'no images') while %s",
    (status) => {
      seed({ status });
      mount();
      expect(screen.getByRole("status").textContent).toContain("Loading images…");
      expect(screen.queryByText("No images were produced by this run.")).toBeNull();
    }
  );

  it("keeps showing already-loaded images while a refresh is loading", () => {
    seed({ status: "loading", artifacts: [artifact("a1")] });
    mount();
    expect(screen.queryByText("Loading images…")).toBeNull();
    expect(screen.getByRole("figure", { name: "Generated image 1 of 1" })).toBeTruthy();
  });

  it("says honestly that a ready run produced no images", () => {
    seed({ artifacts: [artifact("other", { run_id: "r2" })] });
    mount();
    expect(screen.getByRole("region", { name: "Image outputs" })).toBeTruthy();
    expect(screen.getByText("No images were produced by this run.")).toBeTruthy();
    expect(screen.queryByRole("figure")).toBeNull();
  });

  it("lists only this run's images, including uncommitted ones as unavailable", () => {
    seed({
      artifacts: [
        artifact("a1", { ordinal: 0 }),
        artifact("a2", { ordinal: 1, state: "unavailable" }),
        artifact("x1", { run_id: "r2" }),
        artifact("y1", { session_id: "s2" }),
      ],
    });
    mount();
    const group = screen.getByRole("group", { name: "Generated images" });
    expect(within(group).getAllByRole("figure")).toHaveLength(2);
    expect(
      within(group).getByRole("figure", { name: "Generated image 2 of 2" }).textContent
    ).toContain("This image is unavailable.");
    expect(loadImagePreview).toHaveBeenCalledTimes(1); // the uncommitted one is never loaded
  });

  it("shows tracked jobs of this run with count and safe reason, and a partial failure beside its images", () => {
    seed({
      artifacts: [artifact("a1")],
      jobs: [
        job({
          job_id: "job-1",
          state: "partial_failed",
          terminal_at_ms: 9,
          safe_code: "image_publish_failed",
        }),
        job({ job_id: "job-other", run_id: "r2", state: "succeeded", terminal_at_ms: 9 }),
      ],
    });
    mount();
    expect(
      screen.getByText("Partially failed · 1 of 2 images · The generated image could not be saved.")
    ).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByRole("figure")).toBeTruthy();
  });

  it("renders progressbar, percentage, and backend badge without reporting failed jobs as 100%", () => {
    seed({
      jobs: [
        job({
          job_id: "job-1",
          state: "running",
          requested_count: 2,
          completed_count: 1,
          effective_backend: "vulkan",
        }),
        job({
          job_id: "job-2",
          created_at_ms: 2,
          state: "failed",
          terminal_at_ms: 9,
          requested_count: 1,
          completed_count: 0,
          effective_backend: "cpu",
          safe_code: "image_native_failed",
        }),
      ],
    });
    mount();
    const bar1 = screen.getByRole("progressbar", { name: "Image job 1 progress" });
    expect(bar1.getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("VULKAN")).toBeTruthy();

    const bar2 = screen.getByRole("progressbar", { name: "Image job 2 progress" });
    expect(bar2.getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByText("0%")).toBeTruthy();
    expect(screen.getByText("CPU")).toBeTruthy();
  });

  it("cancels an active job through the store and shows 'Cancel requested' without a button", async () => {
    seed({ jobs: [job({ state: "running" })] });
    cancelJob.mockImplementation(async () => {
      useImageArtifactStore.setState({
        jobs: { "job-1": job({ revision: 2, state: "cancel_requested" }) },
      });
    });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "Cancel image job 1" }));
    expect(cancelJob).toHaveBeenCalledWith("job-1");

    expect(screen.getByText("Cancel requested · 1 of 2 images")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Cancel image job/ })).toBeNull();
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    // The pressed button unmounted: keyboard focus stays in the job's row, not on <body>.
    expect(document.activeElement).toBe(screen.getByRole("listitem"));
  });

  it("labels every job's Cancel button unambiguously by ordinal", () => {
    seed({
      jobs: [
        job({ job_id: "job-1", created_at_ms: 1 }),
        job({ job_id: "job-2", created_at_ms: 2, state: "admitted" }),
      ],
    });
    mount();
    expect(screen.getByRole("button", { name: "Cancel image job 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel image job 2" })).toBeTruthy();
  });

  it("shows a pending state while a cancel is in flight, keeps focus, and ignores a second press", async () => {
    seed({ jobs: [job({ state: "running" })] });
    let finish: () => void = () => undefined;
    cancelJob.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    mount();
    const button = screen.getByRole("button", { name: "Cancel image job 1" });
    await user.click(button);

    const pending = screen.getByRole("button", { name: "Cancelling image job 1" });
    expect(pending.getAttribute("aria-busy")).toBe("true");
    expect(pending.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(pending);
    await user.click(pending);
    expect(cancelJob).toHaveBeenCalledTimes(1);

    await act(async () => finish());
  });

  it("shows a fixed alert when the cancel does not take effect and keeps the job's real state", async () => {
    seed({ jobs: [job({ state: "running" })] });
    cancelJob.mockResolvedValue(undefined); // store left the job untouched (request failed)
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "Cancel image job 1" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not cancel the image job. Check its status. (image job 1)"
    );
    expect(screen.getByText("Generating · 1 of 2 images")).toBeTruthy();
    expect(screen.queryByText(/Cancelled|Cancel requested/)).toBeNull();
    // The button is back (not pending) and the alert clears on the next attempt.
    cancelJob.mockImplementation(async () => {
      useImageArtifactStore.setState({
        jobs: { "job-1": job({ revision: 2, state: "cancel_requested" }) },
      });
    });
    await user.click(screen.getByRole("button", { name: "Cancel image job 1" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  describe("recovery", () => {
    it.each(["unavailable", "error"] as const)(
      "%s: honest message and a Retry that refreshes the session",
      async (status) => {
        seed({ status });
        const user = userEvent.setup();
        mount();
        expect(screen.getByText("Image history is unavailable.")).toBeTruthy();
        expect(screen.queryByText("No images were produced by this run.")).toBeNull();
        await user.click(screen.getByRole("button", { name: "Retry" }));
        expect(refreshSession).toHaveBeenCalledWith("s1");
      }
    );

    it("stale with an empty list asks for a Retry; with a list it keeps the images", async () => {
      seed({ status: "stale" });
      const user = userEvent.setup();
      mount();
      expect(screen.getByText("Image history could not be refreshed.")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Retry" }));
      expect(refreshSession).toHaveBeenCalledWith("s1");

      act(() => {
        useImageArtifactStore.setState({ artifacts: [artifact("a1")] });
      });
      expect(screen.getByText("Image history could not be refreshed.")).toBeTruthy();
      expect(screen.getByRole("figure")).toBeTruthy();
    });

    it("shows the fixed capability notice with 'Check again' when the read is lost after readers were seen", async () => {
      seed({ artifacts: [artifact("a1")] });
      const user = userEvent.setup();
      const { container } = mount();
      expect(screen.getByRole("figure")).toBeTruthy();

      act(() => {
        useImageArtifactStore.setState({
          capabilities: { status: "unknown", readers: false, generation: false },
          status: "unavailable",
          artifacts: [],
        });
      });
      expect(container.firstChild).not.toBeNull();
      expect(screen.getByRole("status").textContent).toBe("Image history could not be checked.");
      await user.click(screen.getByRole("button", { name: "Check again" }));
      expect(refreshSession).toHaveBeenCalledWith("s1");
    });

    it("disappears when the server then says readers are off", () => {
      seed({});
      const { container } = mount();
      expect(container.firstChild).not.toBeNull();
      act(() => {
        useImageArtifactStore.setState({
          capabilities: { status: "known", readers: false, generation: false },
        });
      });
      expect(container.firstChild).toBeNull();
    });
  });

  describe("focus handoff after a recovery", () => {
    const LOST = { status: "unknown", readers: false, generation: false } as const;

    it("'Check again': focus moves to the section heading once the read recovered, not before", async () => {
      seed({ capabilities: LOST, status: "unavailable" });
      const user = userEvent.setup();
      mount();
      const button = screen.getByRole("button", { name: "Check again" });
      await user.click(button);
      expect(document.activeElement).toBe(button);

      // The check starts: the whole panel is hidden again while availability is unknown.
      act(() => useImageArtifactStore.setState({ status: "loading" }));
      expect(button.isConnected).toBe(false);
      expect(document.activeElement).toBe(document.body);

      act(() => useImageArtifactStore.setState({ capabilities: READERS, status: "ready" }));
      const heading = screen.getByRole("heading", { name: "Image outputs" });
      expect(heading.getAttribute("tabindex")).toBe("-1");
      expect(document.activeElement).toBe(heading);
    });

    it("'Check again' failing again puts focus back on the reappearing button", async () => {
      seed({ capabilities: LOST, status: "unavailable" });
      const user = userEvent.setup();
      mount();
      await user.click(screen.getByRole("button", { name: "Check again" }));
      act(() => useImageArtifactStore.setState({ status: "loading" }));
      act(() => useImageArtifactStore.setState({ status: "unavailable" }));
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Check again" }));
    });

    it("listing 'Retry': focus moves to the heading once the listing recovered", async () => {
      seed({ status: "unavailable" });
      const user = userEvent.setup();
      mount();
      await user.click(screen.getByRole("button", { name: "Retry" }));
      act(() => useImageArtifactStore.setState({ status: "loading" }));
      expect(document.activeElement).toBe(document.body);
      act(() => useImageArtifactStore.setState({ status: "ready", artifacts: [artifact("a1")] }));
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Image outputs" }));
    });

    it("leaves focus alone when the user moved it elsewhere before the recovery finished", async () => {
      seed({ capabilities: LOST, status: "unavailable" });
      const user = userEvent.setup();
      render(
        <>
          <input aria-label="chat input" />
          <RunImageOutcomesPanel sessionId="s1" runId="r1" />
        </>
      );
      useImageArtifactStore.setState({ refreshSession, cancelJob });
      await user.click(screen.getByRole("button", { name: "Check again" }));
      act(() => useImageArtifactStore.setState({ status: "loading" }));
      const input = screen.getByLabelText("chat input");
      input.focus();
      act(() => useImageArtifactStore.setState({ capabilities: READERS, status: "ready" }));
      expect(document.activeElement).toBe(input);
    });

    it("does not move focus that was never in the notice", () => {
      seed({ capabilities: LOST, status: "unavailable" });
      render(
        <>
          <input aria-label="chat input" />
          <RunImageOutcomesPanel sessionId="s1" runId="r1" />
        </>
      );
      const input = screen.getByLabelText("chat input");
      input.focus();
      act(() => useImageArtifactStore.setState({ status: "loading" }));
      act(() => useImageArtifactStore.setState({ capabilities: READERS, status: "ready" }));
      expect(document.activeElement).toBe(input);
    });
  });

  describe("cancel failure alert lifetime", () => {
    it("goes away once the job is no longer cancelable (terminal or cancel requested)", async () => {
      seed({ jobs: [job({ state: "running" })] });
      cancelJob.mockResolvedValue(undefined); // the store left the job untouched: request failed
      const user = userEvent.setup();
      mount();
      await user.click(screen.getByRole("button", { name: "Cancel image job 1" }));
      expect((await screen.findByRole("alert")).textContent).toContain("image job 1");

      act(() => {
        useImageArtifactStore.setState({
          jobs: { "job-1": job({ revision: 2, state: "succeeded", terminal_at_ms: 5 }) },
        });
      });
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });
});
