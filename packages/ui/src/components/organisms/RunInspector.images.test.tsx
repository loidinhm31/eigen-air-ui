// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ImageArtifactRef,
  ImageJobSnapshot,
  RunSnapshotDto,
} from "@eigen-air-ui/shared/types";
import { setArtifactService, setConfigService } from "../../adapters/factory/ServiceFactory.js";
import {
  ArtifactAdapterError,
  type IArtifactAdapter,
} from "../../adapters/factory/interfaces/IArtifactAdapter.js";
import type { IConfigService } from "../../adapters/factory/interfaces/IConfigService.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import {
  configureImageArtifactStore,
  disposeImageArtifactStore,
  useImageArtifactStore,
} from "../../stores/image-artifact-store.js";
import { RunInspector } from "./RunInspector.js";

const READERS = { image_artifacts: true, image_artifacts_version: "image_artifacts.v1" };
const listAllArtifacts = vi.fn();
const getConfig = vi.fn();
// Bytes never resolve: attachments stay in their loading state (deterministic, no crypto/blob I/O).
const fetchArtifactBytes = vi.fn(() => new Promise<never>(() => {}));
const cancelJob = vi.fn();
const getJob = vi.fn();

function artifact(id: string, runId: string): ImageArtifactRef {
  return {
    schema: "image_artifact.v1",
    artifact_id: id,
    job_id: `job-${runId}`,
    session_id: "session-a",
    run_id: runId,
    ordinal: Number(id.slice(-1)) || 0,
    mime: "image/png",
    width: 64,
    height: 64,
    byte_size: 10,
    sha256: "a".repeat(64),
    created_at_ms: 1,
    state: "committed",
  };
}

function snapshot(
  overrides: Partial<RunSnapshotDto["run"]> = {},
  lifecycle: RunSnapshotDto["run"]["lifecycle_status"] = "completed"
): RunSnapshotDto {
  return {
    schema_version: 1,
    run: {
      run_id: "run-a",
      trace_id: "trace-a",
      request_id: null,
      session_id: "session-a",
      parent_run_id: null,
      root_run_id: "run-a",
      tenant_id: "tenant-a",
      user_id: "user-a",
      workspace_id: "workspace-a",
      agent_id: "agent-a",
      provider_id: "provider-a",
      channel: "web",
      lifecycle_status: lifecycle,
      started_at_ms: 1,
      updated_at_ms: 2,
      snapshot_seq: 1,
      correlation_state: "correlated",
      redaction: { metadata_only: true, debug_requested: false, debug_available: false },
      ...overrides,
    },
    events: [],
    tool_calls: [],
    memory_lineage: [],
  };
}

function renderInspector(dto: RunSnapshotDto) {
  return render(
    <RunInspector
      snapshot={dto}
      canRequestDebug={false}
      onRequestDebug={vi.fn()}
      onClearDebug={vi.fn()}
    />
  );
}

describe("RunInspector image outputs", () => {
  beforeEach(() => {
    listAllArtifacts.mockReset().mockResolvedValue([]);
    getConfig.mockReset().mockResolvedValue({ capabilities: READERS });
    fetchArtifactBytes.mockClear();
    cancelJob.mockReset();
    getJob.mockReset().mockReturnValue(new Promise(() => {}));
    disposeImageArtifactStore();
    configureImageArtifactStore({ refreshSpacingMs: 0 });
    setArtifactService({
      listAllArtifacts,
      fetchArtifactBytes,
      cancelJob,
      getJob,
    } as unknown as IArtifactAdapter);
    setConfigService({ getConfig } as unknown as IConfigService);
    useConnectionStore.setState({ status: "connected", sessionId: "session-a" });
  });

  afterEach(() => {
    cleanup();
    disposeImageArtifactStore();
  });

  it("shows only this run's images, from the authorized session listing", async () => {
    listAllArtifacts.mockResolvedValue([
      artifact("a-1", "run-a"),
      artifact("a-2", "run-a"),
      artifact("b-1", "run-b"),
    ]);
    renderInspector(snapshot());

    const panel = await screen.findByRole("region", { name: "Image outputs" });
    const group = await within(panel).findByRole("group", { name: "Generated images" });
    expect(within(group).getAllByRole("figure")).toHaveLength(2);
    expect(listAllArtifacts).toHaveBeenCalledTimes(1);
    expect(listAllArtifacts.mock.calls[0]?.[0]).toEqual({ sessionId: "session-a" });
  });

  it("includes incomplete (running) runs", async () => {
    listAllArtifacts.mockResolvedValue([artifact("a-1", "run-a")]);
    renderInspector(snapshot({}, "running"));

    const panel = await screen.findByRole("region", { name: "Image outputs" });
    expect(await within(panel).findAllByRole("figure")).toHaveLength(1);
    expect(screen.getByText("Status: running")).toBeTruthy();
  });

  it("says so when the run produced no images", async () => {
    listAllArtifacts.mockResolvedValue([artifact("b-1", "run-b")]);
    renderInspector(snapshot());

    expect(await screen.findByText("No images were produced by this run.")).toBeTruthy();
    expect(screen.queryByRole("figure")).toBeNull();
  });

  it("renders no image section and lists nothing when readers are not advertised", async () => {
    getConfig.mockResolvedValue({ capabilities: {} });
    renderInspector(snapshot());

    await waitFor(() => expect(getConfig).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Status: completed")).toBeTruthy());
    expect(screen.queryByRole("heading", { name: "Image outputs" })).toBeNull();
    expect(listAllArtifacts).not.toHaveBeenCalled();
  });

  it.each([
    ["session_id", { session_id: "" }],
    ["run_id", { run_id: "" }],
  ])("mounts nothing image-related when the snapshot has no %s", async (_name, overrides) => {
    renderInspector(snapshot(overrides));

    expect(screen.getByText("Run inspector")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getConfig).not.toHaveBeenCalled();
    expect(listAllArtifacts).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Image outputs" })).toBeNull();
  });

  describe("capability read failure", () => {
    it("shows a fixed notice instead of hiding the section, and 'Check again' recovers", async () => {
      listAllArtifacts.mockResolvedValue([artifact("a-1", "run-a")]);
      getConfig.mockRejectedValueOnce(new Error("config down")).mockResolvedValue({
        capabilities: READERS,
      });
      const user = userEvent.setup();
      renderInspector(snapshot());

      const panel = await screen.findByRole("region", { name: "Image outputs" });
      expect(within(panel).getByRole("status").textContent).toBe(
        "Image history could not be checked."
      );
      expect(listAllArtifacts).not.toHaveBeenCalled();
      expect(within(panel).queryByText("No images were produced by this run.")).toBeNull();
      expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();

      await user.click(within(panel).getByRole("button", { name: "Check again" }));
      expect(await within(panel).findAllByRole("figure")).toHaveLength(1);
      expect(within(panel).queryByRole("button", { name: "Check again" })).toBeNull();
      expect(getConfig).toHaveBeenCalledTimes(2);
    });

    it("never lists or shows image figures while capabilities stay unknown", async () => {
      getConfig.mockRejectedValue(new Error("config down"));
      const user = userEvent.setup();
      renderInspector(snapshot());

      await user.click(await screen.findByRole("button", { name: "Check again" }));
      await waitFor(() => expect(getConfig).toHaveBeenCalledTimes(2));
      expect(await screen.findByRole("button", { name: "Check again" })).toBeTruthy();
      expect(listAllArtifacts).not.toHaveBeenCalled();
      expect(screen.queryByRole("figure")).toBeNull();
    });
  });

  describe("tracked job cancel", () => {
    const runningJob: ImageJobSnapshot = {
      schema: "image_job.v1",
      revision: 1,
      created_at_ms: 1,
      updated_at_ms: 1,
      terminal_at_ms: null,
      job_id: "job-run-a",
      session_id: "session-a",
      run_id: "run-a",
      origin: "direct_template",
      template_id: "general-image",
      state: "running",
      requested_count: 2,
      completed_count: 0,
      effective_quality: "balanced",
      effective_width: 512,
      effective_height: 512,
      effective_steps: 10,
      effective_backend: "vulkan",
      effective_model_id: "model-a",
      safe_code: null,
      artifacts: [],
    };

    async function renderWithRunningJob() {
      renderInspector(snapshot({}, "running"));
      await screen.findByRole("region", { name: "Image outputs" });
      act(() => useImageArtifactStore.getState().trackJob(runningJob));
      return userEvent.setup();
    }

    it("shows a fixed alert and the job's real state when the cancel request fails", async () => {
      cancelJob.mockRejectedValue(new ArtifactAdapterError("unavailable"));
      const user = await renderWithRunningJob();

      await user.click(await screen.findByRole("button", { name: "Cancel image job 1" }));

      expect((await screen.findByRole("alert")).textContent).toContain(
        "Could not cancel the image job."
      );
      expect(screen.getByText("Generating · 0 of 2 images")).toBeTruthy();
      expect(screen.queryByText(/Cancel requested|Cancelled/)).toBeNull();
      expect(cancelJob).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Cancel image job 1" })).toBeTruthy();
    });

    it("shows 'Cancel requested' (never 'cancelled') after the request is accepted", async () => {
      cancelJob.mockResolvedValue({
        snapshot: { ...runningJob, revision: 2, state: "cancel_requested" },
      });
      const user = await renderWithRunningJob();

      await user.click(await screen.findByRole("button", { name: "Cancel image job 1" }));

      expect(await screen.findByText("Cancel requested · 0 of 2 images")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button", { name: /Cancel image job/ })).toBeNull();
      expect(screen.queryByText(/Cancelled/)).toBeNull();
    });
  });
});
