// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type {
  ImageJobSnapshot,
  ImageTemplateList,
  ImageTemplateSummary,
} from "@eigen-air-ui/shared/types";
import { setArtifactService } from "../../adapters/factory/ServiceFactory.js";
import {
  ArtifactAdapterError,
  type IArtifactAdapter,
} from "../../adapters/factory/interfaces/IArtifactAdapter.js";
import {
  disposeImageArtifactStore,
  useImageArtifactStore,
} from "../../stores/image-artifact-store.js";
import { DirectImageTemplateAction } from "./DirectImageTemplateAction.js";
import {
  buildDirectImageRequest,
  directImageSubmissions,
  formForTemplate,
  pickDirectImageJob,
  useDirectImageDraft,
  utf8ByteLength,
} from "./direct-image-request.js";

interface FakeArtifactService {
  listTemplates: Mock;
  createJob: Mock;
  getJob: Mock;
  cancelJob: Mock;
}

const ALL_FIELDS = ["prompt", "negative_prompt", "quality", "size", "seed", "n"] as const;

function template(overrides: Partial<ImageTemplateSummary> = {}): ImageTemplateSummary {
  return {
    id: "general-image",
    name: "General Image",
    description: "General-purpose image generation.",
    editable_fields: [...ALL_FIELDS],
    defaults: { quality: "balanced", size: "square", n: 1 },
    ...overrides,
  };
}

function templateList(...templates: ImageTemplateSummary[]): ImageTemplateList {
  return { schema: "image_template_list.v1", revision: 1, templates };
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
    state: "admitted",
    requested_count: 2,
    completed_count: 0,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let service: FakeArtifactService;

function install(templates: ImageTemplateSummary[] = [template()]) {
  service = {
    listTemplates: vi.fn().mockResolvedValue(templateList(...templates)),
    createJob: vi.fn().mockResolvedValue(job()),
    getJob: vi.fn().mockReturnValue(new Promise(() => undefined)),
    cancelJob: vi.fn(),
  };
  setArtifactService(service as unknown as IArtifactAdapter);
}

/** Owner of the draft, like `ChatImageGenerateAction` (which survives the panel closing). */
function Host({ onClose, sessionId = "s1" }: { onClose: () => void; sessionId?: string }) {
  const { draft, onDraftChange } = useDirectImageDraft(sessionId);
  return (
    <DirectImageTemplateAction
      sessionId={sessionId}
      onClose={onClose}
      draft={draft}
      onDraftChange={onDraftChange}
    />
  );
}

async function renderReady(onClose = vi.fn()) {
  const view = render(<Host onClose={onClose} />);
  await screen.findByRole("combobox", { name: "Template" });
  return { ...view, onClose };
}

beforeEach(() => {
  install();
  useImageArtifactStore.getState().setActiveSession("s1");
});

afterEach(() => {
  cleanup();
  disposeImageArtifactStore();
  vi.clearAllMocks();
});

describe("DirectImageTemplateAction", () => {
  it("is a labelled region, loads templates and moves focus to the first field", async () => {
    render(<Host onClose={vi.fn()} />);
    const region = screen.getByRole("region", { name: "Generate image" });
    expect(document.activeElement).toBe(region);
    expect(screen.getByRole("status").textContent).toContain("Loading templates");

    const select = await screen.findByRole("combobox", { name: "Template" });
    // Focus moves in a passive effect that can flush after findByRole resolves (seen under load).
    await waitFor(() => expect(document.activeElement).toBe(select));
    expect(service.listTemplates).toHaveBeenCalledTimes(1);
    expect(screen.getByText("General-purpose image generation.")).toBeTruthy();
  });

  it("closes on Escape from the loading state and from a field, and via the close button", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Host onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    await screen.findByRole("combobox", { name: "Template" });
    await user.click(screen.getByRole("textbox", { name: "Prompt" }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "Close image generator" }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("aborts the template request on unmount", async () => {
    render(<Host onClose={vi.fn()} />).unmount();
    expect(service.listTemplates.mock.calls[0]?.[0]?.signal.aborted).toBe(true);
  });

  it("shows fixed text when templates cannot be loaded", async () => {
    service.listTemplates.mockRejectedValue(new Error("secret internal detail"));
    render(<Host onClose={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Something went wrong. Try again.");

    service.listTemplates.mockRejectedValue(
      new ArtifactAdapterError("unauthorized", { status: 401 })
    );
    cleanup();
    render(<Host onClose={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "You are not authorized to use image generation."
    );
  });

  it("says so when no template is available", async () => {
    service.listTemplates.mockResolvedValue(templateList());
    render(<Host onClose={vi.fn()} />);
    expect(await screen.findByText("No image templates are available.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Generate" })).toBeNull();
  });

  describe("editable_fields gating", () => {
    it("offers only the controls the selected template allows, and resets them on switch", async () => {
      const minimal = template({
        id: "minimal",
        name: "Minimal",
        editable_fields: ["prompt", "size"],
        defaults: { quality: "fast", size: "wide", n: 2 },
      });
      install([template(), minimal]);
      const user = userEvent.setup();
      await renderReady();

      for (const name of [
        "Negative prompt (optional)",
        "Quality",
        "Size",
        "Images",
        "Seed (optional)",
      ]) {
        expect(screen.getByLabelText(name)).toBeTruthy();
      }
      await user.selectOptions(screen.getByRole("combobox", { name: "Template" }), "minimal");
      expect(screen.queryByLabelText("Negative prompt (optional)")).toBeNull();
      expect(screen.queryByLabelText("Quality")).toBeNull();
      expect(screen.queryByLabelText("Images")).toBeNull();
      expect(screen.queryByLabelText("Seed (optional)")).toBeNull();
      expect((screen.getByLabelText("Size") as HTMLSelectElement).value).toBe("wide");
    });

    it("blocks submit for a template that does not accept a prompt", async () => {
      install([template({ editable_fields: ["size"] })]);
      await renderReady();
      expect(screen.queryByRole("textbox", { name: "Prompt" })).toBeNull();
      expect(screen.getByText("This template does not accept a prompt.")).toBeTruthy();
      expect((screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled).toBe(
        true
      );
    });
  });

  describe("validation", () => {
    it("counts UTF-8 bytes, not characters", async () => {
      const user = userEvent.setup();
      await renderReady();
      expect(screen.getByText("0 / 8192 bytes")).toBeTruthy();
      await user.type(screen.getByRole("textbox", { name: "Prompt" }), "é");
      expect(screen.getByText("2 / 8192 bytes")).toBeTruthy();
    });

    it("rejects an empty prompt without sending and focuses the prompt", async () => {
      const user = userEvent.setup();
      await renderReady();
      await user.click(screen.getByRole("button", { name: "Generate" }));

      expect(screen.getByText("Enter a prompt.")).toBeTruthy();
      expect(service.createJob).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Prompt" }));
      expect(screen.getByRole("textbox", { name: "Prompt" }).getAttribute("aria-invalid")).toBe(
        "true"
      );
    });

    it("rejects a prompt over the byte limit and flags the counter", async () => {
      const user = userEvent.setup();
      await renderReady();
      fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), {
        target: { value: "a".repeat(8193) },
      });
      expect(screen.getByText("8193 / 8192 bytes")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Generate" }));
      expect(screen.getAllByText("Prompt is too long (max 8192 bytes).").length).toBeGreaterThan(0);
      expect(service.createJob).not.toHaveBeenCalled();
    });

    it("rejects an invalid seed", async () => {
      const user = userEvent.setup();
      await renderReady();
      await user.type(screen.getByRole("textbox", { name: "Prompt" }), "a fox");
      await user.type(screen.getByLabelText("Seed (optional)"), "12x");
      await user.click(screen.getByRole("button", { name: "Generate" }));
      expect(screen.getByText(/Seed must be a whole number/)).toBeTruthy();
      expect(service.createJob).not.toHaveBeenCalled();
    });
  });

  describe("submit and live status", () => {
    it("sends only what differs from the defaults, tracks the job and reports its live state", async () => {
      const user = userEvent.setup();
      await renderReady();
      await user.type(screen.getByRole("textbox", { name: "Prompt" }), "a red fox");
      await user.type(screen.getByLabelText("Negative prompt (optional)"), "blurry");
      await user.selectOptions(screen.getByLabelText("Quality"), "high");
      await user.selectOptions(screen.getByLabelText("Size"), "wide");
      await user.selectOptions(screen.getByLabelText("Images"), "2");
      await user.type(screen.getByLabelText("Seed (optional)"), "42");
      await user.click(screen.getByRole("button", { name: "Generate" }));

      await waitFor(() => expect(service.createJob).toHaveBeenCalledTimes(1));
      expect(service.createJob.mock.calls[0]?.[0]).toEqual({
        template_id: "general-image",
        prompt: "a red fox",
        negative_prompt: "blurry",
        session_id: "s1",
        settings: { quality: "high", size: "wide", seed: 42, n: 2 },
      });
      const live = await screen.findByText("Queued · 0 of 2 images");
      expect(live.getAttribute("aria-live")).toBe("polite");
      expect(useImageArtifactStore.getState().jobs["job-1"]?.state).toBe("admitted");

      // A job is running: no second submission, Cancel offered.
      expect((screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled).toBe(
        true
      );
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();

      // Later snapshots update the same line.
      act(() => {
        useImageArtifactStore
          .getState()
          .trackJob(job({ revision: 2, state: "running", completed_count: 1 }));
      });
      expect(await screen.findByText("Generating · 1 of 2 images")).toBeTruthy();
    });

    it("omits default and non-editable values from the request", async () => {
      install([template({ editable_fields: ["prompt"] })]);
      const user = userEvent.setup();
      await renderReady();
      await user.type(screen.getByRole("textbox", { name: "Prompt" }), "a fox");
      await user.click(screen.getByRole("button", { name: "Generate" }));
      await waitFor(() => expect(service.createJob).toHaveBeenCalledTimes(1));
      expect(service.createJob.mock.calls[0]?.[0]).toEqual({
        template_id: "general-image",
        prompt: "a fox",
        session_id: "s1",
      });
    });

    it("disables submit while pending and re-enables it after an error with fixed text", async () => {
      let reject!: (error: unknown) => void;
      service.createJob.mockReturnValue(new Promise((_, r) => (reject = r)));
      const user = userEvent.setup();
      await renderReady();
      await user.type(screen.getByRole("textbox", { name: "Prompt" }), "a fox");
      await user.click(screen.getByRole("button", { name: "Generate" }));

      const pending = await screen.findByRole("button", { name: "Submitting…" });
      expect((pending as HTMLButtonElement).disabled).toBe(true);
      expect(pending.getAttribute("aria-busy")).toBe("true");

      await act(async () =>
        reject(
          new ArtifactAdapterError("unavailable", {
            status: 503,
            code: "image_operator_setup_required",
          })
        )
      );
      expect((await screen.findByRole("alert")).textContent).toBe(
        "Image generation needs operator setup."
      );
      expect((screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled).toBe(
        false
      );
    });

    it.each([
      ["image_profile_unqualified", "This device is not qualified for image generation."],
      ["image_policy_denied", "Image generation is not permitted by policy."],
      ["image_busy", "Image generation is busy. Try again shortly."],
      ["image_resource_unavailable", "Image resources are unavailable right now."],
      ["image_indeterminate", "The outcome of image generation is unknown."],
    ] as const)("maps safe code %s to generic text", async (code, text) => {
      service.createJob.mockRejectedValue(new ArtifactAdapterError("unavailable", { code }));
      const user = userEvent.setup();
      await renderReady();
      await user.type(screen.getByRole("textbox", { name: "Prompt" }), "a fox");
      await user.click(screen.getByRole("button", { name: "Generate" }));
      expect((await screen.findByRole("alert")).textContent).toBe(text);
    });

    it("never echoes unexpected error text", async () => {
      service.createJob.mockRejectedValue(new Error("a fox leaked here"));
      const user = userEvent.setup();
      await renderReady();
      await user.type(screen.getByRole("textbox", { name: "Prompt" }), "a fox");
      await user.click(screen.getByRole("button", { name: "Generate" }));
      expect((await screen.findByRole("alert")).textContent).toBe(
        "Something went wrong. Try again."
      );
    });
  });

  describe("cancel", () => {
    async function submitJob() {
      const user = userEvent.setup();
      await renderReady();
      await user.type(screen.getByRole("textbox", { name: "Prompt" }), "a fox");
      await user.click(screen.getByRole("button", { name: "Generate" }));
      await screen.findByRole("button", { name: "Cancel" });
      return user;
    }

    it("requests cancellation with the latest revision and only claims 'Cancel requested'", async () => {
      service.cancelJob.mockResolvedValue({
        snapshot: job({ revision: 2, state: "cancel_requested" }),
        pending: true,
      });
      const user = await submitJob();
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      await waitFor(() => expect(service.cancelJob).toHaveBeenCalledTimes(1));
      expect(service.cancelJob.mock.calls[0]?.[0]).toEqual({
        jobId: "job-1",
        sessionId: "s1",
        runId: "r1",
        expectedRevision: 1,
      });
      expect(await screen.findByText("Cancel requested · 0 of 2 images")).toBeTruthy();
      expect(screen.queryByText(/Cancelled/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("reports a terminal state only once a snapshot says so", async () => {
      service.cancelJob.mockResolvedValue({
        snapshot: job({
          revision: 2,
          state: "cancelled",
          terminal_at_ms: 5,
          safe_code: "image_cancelled",
        }),
        pending: false,
      });
      const user = await submitJob();
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(await screen.findByText(/^Cancelled · 0 of 2 images/)).toBeTruthy();
      expect((screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled).toBe(
        false
      );
    });

    it("shows fixed text when the cancel request fails and the job stays active", async () => {
      service.cancelJob.mockRejectedValue(new ArtifactAdapterError("network"));
      const user = await submitJob();
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect((await screen.findByRole("alert")).textContent).toBe(
        "Could not reach the daemon. Try again."
      );
      expect(screen.getByText("Queued · 0 of 2 images")).toBeTruthy();
    });
  });

  describe("job state lives in the store (close/reopen, late create)", () => {
    async function typeAndSubmit(user: UserEvent) {
      await user.type(screen.getByRole("textbox", { name: "Prompt" }), "a fox");
      await user.click(screen.getByRole("button", { name: /^(Generate|Submitting…)$/ }));
    }

    it("keeps the job status, Cancel and a disabled Generate across close and reopen", async () => {
      const user = userEvent.setup();
      const first = await renderReady();
      await typeAndSubmit(user);
      await screen.findByRole("button", { name: "Cancel" });
      first.unmount();

      await renderReady();
      expect(screen.getByText("Queued · 0 of 2 images")).toBeTruthy();
      expect((screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled).toBe(
        true
      );
      service.cancelJob.mockResolvedValue({
        snapshot: job({ revision: 2, state: "cancel_requested" }),
        pending: true,
      });
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(await screen.findByText("Cancel requested · 0 of 2 images")).toBeTruthy();
      expect(service.cancelJob).toHaveBeenCalledTimes(1);
    });

    it("shows a finished job after reopening and re-enables Generate", async () => {
      useImageArtifactStore
        .getState()
        .trackJob(job({ state: "succeeded", terminal_at_ms: 9, completed_count: 2 }));
      await renderReady();
      expect(screen.getByText(/^Completed · 2 of 2 images/)).toBeTruthy();
      expect((screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled).toBe(
        false
      );
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    });

    it("renders progressbar, percentage, backend badge, and inline image preview when artifacts exist", async () => {
      useImageArtifactStore.getState().trackJob(
        job({
          state: "running",
          requested_count: 2,
          completed_count: 1,
          effective_backend: "vulkan",
        })
      );
      const view = await renderReady();
      const bar = screen.getByRole("progressbar", { name: "Image generation progress" });
      expect(bar.getAttribute("aria-valuenow")).toBe("50");
      expect(screen.getByText("50%")).toBeTruthy();
      expect(screen.getByText("VULKAN")).toBeTruthy();

      act(() => {
        useImageArtifactStore.getState().trackJob(
          job({
            revision: 2,
            state: "succeeded",
            terminal_at_ms: 9,
            requested_count: 2,
            completed_count: 2,
            effective_backend: "vulkan",
            artifacts: [
              {
                schema: "image_artifact.v1",
                artifact_id: "art-1",
                job_id: "job-1",
                session_id: "s1",
                run_id: "r1",
                ordinal: 0,
                mime: "image/png",
                width: 512,
                height: 512,
                byte_size: 100,
                sha256: "a".repeat(64),
                created_at_ms: 5,
                state: "committed",
              },
            ],
          })
        );
      });
      expect(bar.getAttribute("aria-valuenow")).toBe("100");
      expect(screen.getByText("100%")).toBeTruthy();
      expect(screen.getByRole("group", { name: "Generated images" })).toBeTruthy();
      expect(screen.getByRole("figure", { name: "Generated image 1 of 1" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Download image 1 of 1" })).toBeTruthy();
      view.unmount();
    });

    it("a createJob resolving after close still tracks the job, and reopening never double-submits", async () => {
      const gate = deferred<ImageJobSnapshot>();
      service.createJob.mockReturnValue(gate.promise);
      const user = userEvent.setup();
      const first = await renderReady();
      await typeAndSubmit(user);
      await screen.findByRole("button", { name: "Submitting…" });
      first.unmount();
      expect(directImageSubmissions.isPending("s1")).toBe(true);

      // Reopened while the request is unresolved: Submitting…, no second request.
      await renderReady();
      expect(screen.getByText("Submitting image job…")).toBeTruthy();
      const submit = screen.getByRole("button", { name: "Submitting…" }) as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
      await user.type(screen.getByRole("textbox", { name: "Prompt" }), "again");
      fireEvent.submit(submit.closest("form")!);
      expect(service.createJob).toHaveBeenCalledTimes(1);
      // Not aborted by the close.
      expect(service.createJob.mock.calls[0]?.[1]?.signal).toBeUndefined();

      await act(async () => gate.resolve(job()));
      expect(useImageArtifactStore.getState().jobs["job-1"]?.state).toBe("admitted");
      expect(directImageSubmissions.isPending("s1")).toBe(false);
      expect(await screen.findByText("Queued · 0 of 2 images")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
      expect((screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled).toBe(
        true
      );
    });

    it("a createJob resolving after a session change tracks nothing and leaves no pending state", async () => {
      const gate = deferred<ImageJobSnapshot>();
      service.createJob.mockReturnValue(gate.promise);
      const user = userEvent.setup();
      const first = await renderReady();
      await typeAndSubmit(user);
      await screen.findByRole("button", { name: "Submitting…" });
      first.unmount();
      act(() => useImageArtifactStore.getState().setActiveSession("s2"));

      await act(async () => gate.resolve(job()));
      expect(Object.keys(useImageArtifactStore.getState().jobs)).toEqual([]);
      expect(directImageSubmissions.isPending("s1")).toBe(false);
    });

    it("a failed createJob after close is swallowed and frees the registry", async () => {
      const gate = deferred<ImageJobSnapshot>();
      service.createJob.mockReturnValue(gate.promise);
      const user = userEvent.setup();
      const first = await renderReady();
      await typeAndSubmit(user);
      await screen.findByRole("button", { name: "Submitting…" });
      first.unmount();
      await act(async () => gate.reject(new Error("boom")));
      expect(directImageSubmissions.isPending("s1")).toBe(false);
      expect(Object.keys(useImageArtifactStore.getState().jobs)).toEqual([]);
    });

    it("ignores jobs of other origins and sessions", async () => {
      const agentJob = job({ job_id: "job-agent", origin: "agent_tool", tool_call_id: "call-1" });
      delete agentJob.template_id;
      useImageArtifactStore.getState().trackJob(agentJob);
      await renderReady();
      expect(screen.queryByText(/ of \d+ images/)).toBeNull();
      expect((screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled).toBe(
        false
      );
    });
  });

  describe("focus", () => {
    it("moves focus to the status node after submit and keeps Escape working", async () => {
      const user = userEvent.setup();
      const { onClose } = await renderReady();
      await user.type(screen.getByRole("textbox", { name: "Prompt" }), "a fox");
      await user.click(screen.getByRole("button", { name: "Generate" }));
      await screen.findByRole("button", { name: "Cancel" });

      const status = document.querySelector("[data-image-action-status]");
      expect(status).not.toBeNull();
      expect(document.activeElement).toBe(status);
      expect(document.activeElement).not.toBe(document.body);
      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("keeps focus in the panel while cancelling, when Cancel disappears", async () => {
      service.cancelJob.mockResolvedValue({
        snapshot: job({ revision: 2, state: "cancel_requested" }),
        pending: true,
      });
      const user = userEvent.setup();
      await renderReady();
      await user.type(screen.getByRole("textbox", { name: "Prompt" }), "a fox");
      await user.click(screen.getByRole("button", { name: "Generate" }));
      await user.click(await screen.findByRole("button", { name: "Cancel" }));
      await screen.findByText("Cancel requested · 0 of 2 images");
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
      expect(document.activeElement).toBe(document.querySelector("[data-image-action-status]"));
    });

    it("does not steal focus when the user already moved outside the panel", async () => {
      const user = userEvent.setup();
      render(
        <>
          <input aria-label="outside" />
          <Host onClose={vi.fn()} />
        </>
      );
      await screen.findByRole("combobox", { name: "Template" });
      await user.type(screen.getByRole("textbox", { name: "Prompt" }), "a fox");
      const outside = screen.getByLabelText("outside");
      outside.focus();
      fireEvent.submit(screen.getByRole("button", { name: "Generate" }).closest("form")!);
      await screen.findByRole("button", { name: "Cancel" });
      expect(document.activeElement).toBe(outside);
    });

    it("does not steal focus on template load when the user moved elsewhere", async () => {
      const gate = deferred<ImageTemplateList>();
      service.listTemplates.mockReturnValue(gate.promise);
      render(
        <>
          <input aria-label="outside" />
          <Host onClose={vi.fn()} />
        </>
      );
      const outside = screen.getByLabelText("outside");
      outside.focus();
      await act(async () => gate.resolve(templateList(template())));
      await screen.findByRole("combobox", { name: "Template" });
      expect(document.activeElement).toBe(outside);
    });

    it("focuses the first invalid field (negative prompt, then seed) and links its alert", async () => {
      const user = userEvent.setup();
      await renderReady();
      fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), {
        target: { value: "a fox" },
      });
      fireEvent.change(screen.getByLabelText("Negative prompt (optional)"), {
        target: { value: "x".repeat(2049) },
      });
      fireEvent.change(screen.getByLabelText("Seed (optional)"), { target: { value: "12x" } });
      await user.click(screen.getByRole("button", { name: "Generate" }));

      const negative = screen.getByLabelText("Negative prompt (optional)");
      expect(document.activeElement).toBe(negative);
      expect(negative.getAttribute("aria-invalid")).toBe("true");
      const errorId = negative.getAttribute("aria-describedby")!.split(" ")[1]!;
      const alert = document.getElementById(errorId)!;
      expect(alert.getAttribute("role")).toBe("alert");
      expect(alert.textContent).toMatch(/Negative prompt is too long/);

      fireEvent.change(negative, { target: { value: "" } });
      await user.click(screen.getByRole("button", { name: "Generate" }));
      const seed = screen.getByLabelText("Seed (optional)");
      expect(document.activeElement).toBe(seed);
      expect(document.getElementById(seed.getAttribute("aria-describedby")!)?.textContent).toMatch(
        /Seed must be a whole number/
      );
      expect(service.createJob).not.toHaveBeenCalled();
    });

    it("announces a prompt error as an alert tied to the prompt", async () => {
      const user = userEvent.setup();
      await renderReady();
      await user.click(screen.getByRole("button", { name: "Generate" }));
      const prompt = screen.getByRole("textbox", { name: "Prompt" });
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toBe("Enter a prompt.");
      expect(prompt.getAttribute("aria-describedby")).toContain(alert.id);
    });

    it("reaches every control with Tab in DOM order, status node excluded", async () => {
      const user = userEvent.setup();
      await renderReady();
      screen.getByRole("button", { name: "Close image generator" }).focus();
      const visited: string[] = [];
      for (let step = 0; step < 8; step++) {
        await user.tab();
        const el = document.activeElement as HTMLElement & { labels?: NodeListOf<HTMLElement> };
        visited.push(el.labels?.[0]?.textContent ?? el.textContent ?? "");
      }
      expect(visited).toEqual([
        "Template",
        "Prompt",
        "Negative prompt (optional)",
        "Quality",
        "Size",
        "Images",
        "Seed (optional)",
        "Generate",
      ]);
    });
  });

  describe("layout and template retry", () => {
    it("scrolls the fields internally while Generate/status stay outside the scroller", async () => {
      await renderReady();
      const region = screen.getByRole("region", { name: "Generate image" });
      expect(region.className).toContain("max-h-[calc(100dvh-6rem)]");
      const scroller = screen.getByLabelText("Seed (optional)").closest(".overflow-y-auto");
      expect(scroller).not.toBeNull();
      expect(scroller!.contains(screen.getByRole("button", { name: "Generate" }))).toBe(false);
      expect(scroller!.contains(document.querySelector("[data-image-action-status]"))).toBe(false);
    });

    it("offers Retry inside the panel after a template load failure", async () => {
      service.listTemplates.mockRejectedValueOnce(new Error("down"));
      const user = userEvent.setup();
      render(<Host onClose={vi.fn()} />);
      expect((await screen.findByRole("alert")).textContent).toBe(
        "Something went wrong. Try again."
      );
      await user.click(screen.getByRole("button", { name: "Retry" }));

      const select = await screen.findByRole("combobox", { name: "Template" });
      expect(service.listTemplates).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("alert")).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(select));
    });
  });

  describe("draft owned by the surviving host", () => {
    /** Owner that can close and reopen the panel, like `ChatImageGenerateAction`. */
    function Reopenable({ sessionId = "s1" }: { sessionId?: string }) {
      const [open, setOpen] = React.useState(true);
      const { draft, onDraftChange } = useDirectImageDraft(sessionId);
      return (
        <>
          <button onClick={() => setOpen((o) => !o)}>toggle</button>
          {open && (
            <DirectImageTemplateAction
              sessionId={sessionId}
              onClose={() => setOpen(false)}
              draft={draft}
              onDraftChange={onDraftChange}
            />
          )}
        </>
      );
    }

    it("keeps prompt, negative prompt, template and settings across Escape and reopen", async () => {
      install([template(), template({ id: "poster", name: "Poster" })]);
      const user = userEvent.setup();
      render(<Reopenable />);
      await user.type(await screen.findByRole("textbox", { name: "Prompt" }), "a red fox");
      await user.type(screen.getByLabelText("Negative prompt (optional)"), "blurry");
      await user.selectOptions(screen.getByLabelText("Template"), "poster");
      await user.selectOptions(screen.getByLabelText("Quality"), "high");
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("region", { name: "Generate image" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "toggle" }));
      await screen.findByRole("textbox", { name: "Prompt" });
      expect((screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement).value).toBe(
        "a red fox"
      );
      expect(
        (screen.getByLabelText("Negative prompt (optional)") as HTMLTextAreaElement).value
      ).toBe("blurry");
      expect((screen.getByLabelText("Template") as HTMLSelectElement).value).toBe("poster");
      expect((screen.getByLabelText("Quality") as HTMLSelectElement).value).toBe("high");
    });

    it("edits the other settings of a retained draft without resetting them (draft template listed)", async () => {
      install([template(), template({ id: "poster", name: "Poster" })]);
      const user = userEvent.setup();
      render(<Reopenable />);
      await user.type(await screen.findByRole("textbox", { name: "Prompt" }), "a fox");
      await user.selectOptions(screen.getByLabelText("Template"), "poster");
      await user.type(screen.getByLabelText("Seed (optional)"), "5");
      await user.selectOptions(screen.getByLabelText("Size"), "tall");
      await user.selectOptions(screen.getByLabelText("Images"), "3");
      await user.keyboard("{Escape}");
      await user.click(screen.getByRole("button", { name: "toggle" }));
      await user.selectOptions(await screen.findByLabelText("Quality"), "high");

      const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
      expect([value("Template"), value("Prompt"), value("Quality"), value("Size")]).toEqual([
        "poster",
        "a fox",
        "high",
        "tall",
      ]);
      expect([value("Images"), value("Seed (optional)")]).toEqual(["3", "5"]);
    });

    it("keeps every setting editable when the draft's template disappeared from the list", async () => {
      const poster = template({
        id: "poster",
        name: "Poster",
        defaults: { quality: "fast", size: "wide", n: 2 },
      });
      const user = userEvent.setup();
      render(<Reopenable />);
      // Draft of the (about to vanish) first template, with settings that must not leak.
      await user.type(await screen.findByRole("textbox", { name: "Prompt" }), "a fox");
      await user.selectOptions(screen.getByLabelText("Quality"), "max");
      await user.selectOptions(screen.getByLabelText("Size"), "tall");
      await user.selectOptions(screen.getByLabelText("Images"), "4");
      await user.type(screen.getByLabelText("Seed (optional)"), "7");
      await user.keyboard("{Escape}");

      service.listTemplates.mockResolvedValue(templateList(poster));
      await user.click(screen.getByRole("button", { name: "toggle" }));
      await screen.findByRole("textbox", { name: "Prompt" });
      const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
      // Only the typed text survives; settings come from the template that is shown.
      expect([value("Template"), value("Prompt"), value("Quality"), value("Size")]).toEqual([
        "poster",
        "a fox",
        "fast",
        "wide",
      ]);
      expect([value("Images"), value("Seed (optional)")]).toEqual(["2", ""]);

      await user.type(screen.getByLabelText("Seed (optional)"), "42");
      await user.selectOptions(screen.getByLabelText("Quality"), "high");
      await user.selectOptions(screen.getByLabelText("Size"), "portrait");
      await user.selectOptions(screen.getByLabelText("Images"), "3");
      expect([value("Quality"), value("Size"), value("Images"), value("Seed (optional)")]).toEqual([
        "high",
        "portrait",
        "3",
        "42",
      ]);

      await user.click(screen.getByRole("button", { name: "Generate" }));
      await waitFor(() => expect(service.createJob).toHaveBeenCalledTimes(1));
      expect(service.createJob.mock.calls[0]?.[0]).toEqual({
        template_id: "poster",
        prompt: "a fox",
        session_id: "s1",
        settings: { quality: "high", size: "portrait", seed: 42, n: 3 },
      });
    });

    it("drops the draft on a successful submit but keeps it when the submit fails", async () => {
      service.createJob.mockRejectedValueOnce(new Error("secret"));
      const user = userEvent.setup();
      render(<Reopenable />);
      await user.type(await screen.findByRole("textbox", { name: "Prompt" }), "a fox");
      await user.click(screen.getByRole("button", { name: "Generate" }));
      await screen.findByRole("alert");
      await user.keyboard("{Escape}");
      await user.click(screen.getByRole("button", { name: "toggle" }));
      expect(
        (await screen.findByRole("textbox", { name: "Prompt" })) as HTMLTextAreaElement
      ).toHaveProperty("value", "a fox");

      await user.click(screen.getByRole("button", { name: "Generate" }));
      await screen.findByText("Queued · 0 of 2 images");
      expect((screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement).value).toBe(
        ""
      );
      await user.keyboard("{Escape}");
      await user.click(screen.getByRole("button", { name: "toggle" }));
      expect(
        ((await screen.findByRole("textbox", { name: "Prompt" })) as HTMLTextAreaElement).value
      ).toBe("");
    });

    it("a late submit result never wipes text typed after the panel was reopened", async () => {
      const gate = deferred<ImageJobSnapshot>();
      service.createJob.mockReturnValue(gate.promise);
      const user = userEvent.setup();
      render(<Reopenable />);
      await user.type(await screen.findByRole("textbox", { name: "Prompt" }), "first");
      await user.click(screen.getByRole("button", { name: "Generate" }));
      await waitFor(() => expect(service.createJob).toHaveBeenCalledTimes(1));
      await user.keyboard("{Escape}");
      await user.click(screen.getByRole("button", { name: "toggle" }));
      await user.type(await screen.findByRole("textbox", { name: "Prompt" }), " second");

      await act(async () => gate.resolve(job()));
      expect((screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement).value).toBe(
        "first second"
      );
    });

    it("does not carry the draft into another session", async () => {
      const user = userEvent.setup();
      const view = render(<Reopenable sessionId="s1" />);
      await user.type(await screen.findByRole("textbox", { name: "Prompt" }), "for session one");
      await user.keyboard("{Escape}");

      view.rerender(<Reopenable sessionId="s2" />);
      await user.click(screen.getByRole("button", { name: "toggle" }));
      expect(
        ((await screen.findByRole("textbox", { name: "Prompt" })) as HTMLTextAreaElement).value
      ).toBe("");
      await user.keyboard("{Escape}");

      view.rerender(<Reopenable sessionId="s1" />);
      await user.click(screen.getByRole("button", { name: "toggle" }));
      expect(
        ((await screen.findByRole("textbox", { name: "Prompt" })) as HTMLTextAreaElement).value
      ).toBe("");
    });

    it("never writes the draft to web storage and never puts it into labels, live regions or errors", async () => {
      const TOKEN = "zq-private-draft-token";
      const setItem = vi.spyOn(Storage.prototype, "setItem");
      service.createJob.mockRejectedValueOnce(new Error(TOKEN));
      const user = userEvent.setup();
      render(<Reopenable />);
      await user.type(await screen.findByRole("textbox", { name: "Prompt" }), TOKEN);
      await user.type(screen.getByLabelText("Negative prompt (optional)"), TOKEN);
      await user.click(screen.getByRole("button", { name: "Generate" }));
      expect((await screen.findByRole("alert")).textContent).toBe(
        "Something went wrong. Try again."
      );
      await user.keyboard("{Escape}");
      await user.click(screen.getByRole("button", { name: "toggle" }));
      await screen.findByRole("textbox", { name: "Prompt" });

      expect(setItem).not.toHaveBeenCalled();
      expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(TOKEN);
      for (const element of document.querySelectorAll("*")) {
        for (const attribute of element.attributes) expect(attribute.value).not.toContain(TOKEN);
      }
      for (const live of document.querySelectorAll('[role="alert"],[role="status"],[aria-live]')) {
        expect(live.textContent).not.toContain(TOKEN);
      }
      setItem.mockRestore();
    });
  });
});

describe("buildDirectImageRequest", () => {
  const base = template();

  it("rejects NUL characters and over-long negative prompts without echoing them", () => {
    const form = { ...formForTemplate(base), prompt: "a\u0000b", negativePrompt: "x".repeat(2049) };
    const result = buildDirectImageRequest(base, form, "s1");
    expect(result).toEqual({
      errors: {
        prompt: "Prompt contains an unsupported character.",
        negativePrompt: "Negative prompt is too long (max 2048 bytes).",
      },
    });
  });

  it("ignores values of fields the template does not allow", () => {
    const limited = template({ editable_fields: ["prompt"] });
    const form = {
      ...formForTemplate(limited),
      prompt: "a fox",
      negativePrompt: "blurry",
      quality: "max",
      seed: "7",
      n: "4",
    };
    expect(buildDirectImageRequest(limited, form, "s1")).toEqual({
      request: { template_id: "general-image", prompt: "a fox", session_id: "s1" },
    });
  });

  it("lets the shared validator reject what the form cannot (identifier charset)", () => {
    const odd = template({ id: "bad id with spaces" });
    const form = { ...formForTemplate(odd), prompt: "a fox" };
    expect(buildDirectImageRequest(odd, form, "s1")).toEqual({
      errors: { form: "The request is not valid. Check the fields and try again." },
    });
  });
});

describe("pickDirectImageJob", () => {
  const active = (id: string, at: number) => job({ job_id: id, created_at_ms: at });
  const done = (id: string, at: number) =>
    job({ job_id: id, created_at_ms: at, state: "succeeded", terminal_at_ms: at + 1 });

  it("prefers the newest active job so every active job stays cancelable in turn", () => {
    expect(pickDirectImageJob([active("a", 1), active("b", 2), done("c", 3)], "s1")?.job_id).toBe(
      "b"
    );
  });

  it("falls back to the newest job and filters by origin and session", () => {
    const agent = { ...done("agent", 9), origin: "agent_tool" as const };
    const other = { ...active("other", 8), session_id: "s2" };
    expect(pickDirectImageJob([done("a", 1), done("b", 2), agent, other], "s1")?.job_id).toBe("b");
    expect(pickDirectImageJob([agent, other], "s1")).toBeUndefined();
  });
});

describe("utf8ByteLength", () => {
  it("matches TextEncoder, including astral characters and lone surrogates", () => {
    for (const sample of ["", "abc", "é", "日本語", "😀", "a😀b", "\ud83d", "\ude00x", "\ud83dx"]) {
      expect(utf8ByteLength(sample)).toBe(new TextEncoder().encode(sample).length);
    }
  });
});
