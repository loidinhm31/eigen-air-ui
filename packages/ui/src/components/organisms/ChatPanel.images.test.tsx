// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ImageArtifactRef,
  ImageJobSnapshot,
  ImageTemplateSummary,
} from "@eigen-air-ui/shared/types";
import type * as ServiceFactory from "../../adapters/factory/ServiceFactory.js";
import { ArtifactAdapterError } from "../../adapters/factory/interfaces/IArtifactAdapter.js";
import { setArtifactService, setConfigService } from "../../adapters/factory/ServiceFactory.js";
import type { IArtifactAdapter } from "../../adapters/factory/interfaces/IArtifactAdapter.js";
import type { IConfigService } from "../../adapters/factory/interfaces/IConfigService.js";
import { useChatStore } from "../../stores/chatStore.js";
import { useConnectionStore } from "../../stores/connectionStore.js";
import { useDebugSettingsStore } from "../../stores/debugSettingsStore.js";
import {
  configureImageArtifactStore,
  disposeImageArtifactStore,
} from "../../stores/image-artifact-store.js";
import { useReadinessStore } from "../../stores/readinessStore.js";
import { ChatPanel } from "./ChatPanel.js";

const h = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  getHistory: vi.fn(),
  onEvent: undefined as ((event: unknown) => void) | undefined,
  hintHandler: undefined as ((hint: unknown) => void) | undefined,
  reconnectHandler: undefined as (() => void) | undefined,
  hintUnsubscribe: vi.fn(),
}));

vi.mock("../../adapters/factory/ServiceFactory.js", async (importActual) => ({
  ...(await importActual<typeof ServiceFactory>()),
  getChatService: () => ({
    sendMessage: h.sendMessage,
    getHistory: h.getHistory,
    abort: vi.fn().mockResolvedValue(undefined),
    subscribeUserQuestion: () => () => {},
    onRunReconnect: (handler: () => void) => {
      h.reconnectHandler = handler;
      return () => {};
    },
    onImageHint: (handler: (hint: unknown) => void) => {
      h.hintHandler = handler;
      return h.hintUnsubscribe;
    },
  }),
  getSessionService: () => ({ createSession: vi.fn().mockResolvedValue({ id: "session-2" }) }),
  getSkillService: () => ({ list: vi.fn().mockResolvedValue([]) }),
  getUserQuestionService: () => ({
    list: vi.fn().mockResolvedValue({
      schema_version: "user_question.v1",
      questions: [],
      redaction: "metadata_only",
    }),
  }),
  getRunService: () => ({ get: vi.fn() }),
}));

/** Records every observer so tests can fire layout changes (jsdom has no layout). */
class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  constructor(private readonly callback: () => void) {
    ResizeObserverMock.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  fire() {
    this.callback();
  }
}

const RUN_A = "run-alpha-0001";
const RUN_B = "run-beta-0002";
const RUN_ABORTED = "run-aborted-0003";
const RUN_USER_TAGGED = "run-usertag-0004";

const HISTORY = [
  { id: "u1", role: "user", content: "first question" },
  { id: "a1", role: "assistant", content: "first answer", run_id: RUN_A },
  { id: "u2", role: "user", content: "second question", run_id: RUN_USER_TAGGED },
  { id: "a2", role: "assistant", content: "second answer", run_id: RUN_B },
];

const artifact = (id: string, runId: string, ordinal = 0): ImageArtifactRef => ({
  schema: "image_artifact.v1",
  artifact_id: id,
  job_id: `job-${runId}`,
  session_id: "session-1",
  run_id: runId,
  ordinal,
  mime: "image/png",
  width: 64,
  height: 64,
  byte_size: 10,
  sha256: "a".repeat(64),
  created_at_ms: 1,
  state: "committed",
});

const CAPS_FULL = {
  image_artifacts: true,
  image_artifacts_version: "image_artifacts.v1",
  local_image: true,
  local_image_version: "local_image.v1",
};
const CAPS_READERS_ONLY = {
  image_artifacts: true,
  image_artifacts_version: "image_artifacts.v1",
};
const CAPS_GENERATION_ONLY = { local_image: true, local_image_version: "local_image.v1" };

const TEMPLATE: ImageTemplateSummary = {
  id: "general-image",
  name: "General Image",
  description: "General-purpose image generation.",
  editable_fields: ["prompt", "negative_prompt", "quality", "size", "seed", "n"],
  defaults: { quality: "balanced", size: "square", n: 1 },
};

function directJob(overrides: Partial<ImageJobSnapshot> = {}): ImageJobSnapshot {
  return {
    schema: "image_job.v1",
    revision: 1,
    created_at_ms: 1,
    updated_at_ms: 1,
    terminal_at_ms: null,
    job_id: "job-direct-1",
    session_id: "session-1",
    run_id: "run-direct-1",
    origin: "direct_template",
    template_id: "general-image",
    state: "admitted",
    requested_count: 1,
    completed_count: 0,
    effective_quality: "balanced",
    effective_width: 512,
    effective_height: 512,
    effective_steps: 10,
    effective_backend: "vulkan",
    effective_model_id: "model-a",
    safe_code: null,
    artifacts: [],
    ...overrides,
  };
}

const listAllArtifacts = vi.fn();
const getConfig = vi.fn();
const listTemplates = vi.fn();
const createJob = vi.fn();
const getJob = vi.fn();
// Bytes never resolve: previews stay loading (deterministic, no crypto/blob I/O).
const fetchArtifactBytes = vi.fn(() => new Promise<never>(() => {}));

function setup(options: {
  capabilities: Record<string, unknown>;
  artifacts?: ImageArtifactRef[];
  history?: unknown[];
  canInfer?: boolean;
}) {
  getConfig.mockResolvedValue({ capabilities: options.capabilities });
  listAllArtifacts.mockResolvedValue(options.artifacts ?? []);
  h.getHistory.mockResolvedValue({ messages: options.history ?? HISTORY });
  const canInfer = options.canInfer ?? true;
  useReadinessStore.setState({
    phase: canInfer ? "ready" : "failed",
    canInfer,
    snapshot: { status: canInfer ? "ready" : "failed", retryable: false, details: { stages: [] } },
    error: null,
  });
}

function position(a: HTMLElement, b: HTMLElement): "before" | "after" {
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? "before" : "after";
}

const boundGroups = () =>
  screen.queryAllByRole("group", { name: /^Generated images(, run \d+)?$/ });

describe("ChatPanel durable image history", () => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    ResizeObserverMock.instances = [];
    h.sendMessage.mockReset();
    h.getHistory.mockReset();
    h.hintUnsubscribe.mockReset();
    h.onEvent = undefined;
    h.hintHandler = undefined;
    h.reconnectHandler = undefined;
    listAllArtifacts.mockReset();
    getConfig.mockReset();
    listTemplates.mockReset().mockResolvedValue({
      schema: "image_template_list.v1",
      revision: 1,
      templates: [TEMPLATE],
    });
    createJob.mockReset().mockResolvedValue(directJob());
    getJob.mockReset().mockReturnValue(new Promise(() => {}));
    fetchArtifactBytes.mockClear();
    disposeImageArtifactStore();
    configureImageArtifactStore({ refreshSpacingMs: 0 });
    setArtifactService({
      listAllArtifacts,
      listTemplates,
      createJob,
      getJob,
      cancelJob: vi.fn(),
      fetchArtifactBytes,
    } as unknown as IArtifactAdapter);
    setConfigService({ getConfig } as unknown as IConfigService);
    useConnectionStore.setState({ status: "connected", sessionId: "session-1" });
    useChatStore.setState({
      messages: [],
      messageRevision: 0,
      isStreaming: false,
      streamingContent: "",
      streamStatus: null,
      streamError: null,
    });
    useDebugSettingsStore.setState({ showPromptDebug: false, showReasoningDebug: false });
  });

  afterEach(() => {
    cleanup();
    disposeImageArtifactStore();
  });

  it("binds images only after the assistant message with the exact run_id; other runs get labelled groups", async () => {
    setup({
      capabilities: CAPS_READERS_ONLY,
      artifacts: [
        artifact("art-b", RUN_B),
        artifact("art-a", RUN_A),
        artifact("art-a2", RUN_A, 1),
        artifact("art-aborted", RUN_ABORTED),
        artifact("art-user-tagged", RUN_USER_TAGGED),
      ],
    });
    render(<ChatPanel />);

    await waitFor(() => expect(boundGroups()).toHaveLength(2));
    const [groupA, groupB] = boundGroups() as [HTMLElement, HTMLElement];
    expect(within(groupA).getAllByRole("figure")).toHaveLength(2); // real attachments, 2 of RUN_A
    expect(within(groupB).getAllByRole("figure")).toHaveLength(1);
    const answerA = screen.getByText("first answer");
    const questionB = screen.getByText("second question");
    const answerB = screen.getByText("second answer");
    expect(position(answerA, groupA)).toBe("before");
    expect(position(groupA, questionB)).toBe("before");
    expect(position(answerB, groupB)).toBe("before");

    // No assistant message for the aborted turn, and a user message never binds even with a run_id:
    // both render after the whole list, labelled, in artifact order.
    const aborted = screen.getByRole("group", { name: "Images from run run-abor" });
    const userTagged = screen.getByRole("group", { name: "Images from run run-user" });
    expect(position(groupB, aborted)).toBe("before");
    expect(position(groupB, userTagged)).toBe("before");
    expect(groupA.textContent).not.toContain("Images from run");
    expect(screen.queryAllByText(/first answer|second answer/)).toHaveLength(2);
    // Real attachments ask the server-backed loader for bytes with the listing's identity.
    await waitFor(() => expect(fetchArtifactBytes).toHaveBeenCalled());
  });

  it("shows nothing and requests nothing when readers are not advertised", async () => {
    setup({ capabilities: CAPS_GENERATION_ONLY });
    render(<ChatPanel />);

    await screen.findByText("second answer");
    await waitFor(() => expect(getConfig).toHaveBeenCalled());
    await act(async () => {});
    expect(listAllArtifacts).not.toHaveBeenCalled();
    expect(screen.queryByText(/Loading images/)).toBeNull();
    expect(screen.queryByText(/Image history/)).toBeNull();
    expect(boundGroups()).toHaveLength(0);
  });

  it("renders a loading state until the first listing lands, then no 'empty' text", async () => {
    setup({ capabilities: CAPS_READERS_ONLY });
    let release: (items: ImageArtifactRef[]) => void = () => {};
    listAllArtifacts.mockReturnValue(new Promise((resolve) => (release = resolve)));
    render(<ChatPanel />);

    const loading = (await screen.findByText("Loading images…")).closest('[role="status"]');
    expect(loading?.getAttribute("aria-busy")).toBe("true");

    await act(async () => release([artifact("art-a", RUN_A)]));
    await waitFor(() => expect(boundGroups()).toHaveLength(1));
    expect(screen.queryByText(/Loading images/)).toBeNull();
  });

  it("offers Retry after a failed listing and recovers on retry", async () => {
    setup({ capabilities: CAPS_READERS_ONLY });
    listAllArtifacts
      .mockRejectedValueOnce(new ArtifactAdapterError("network"))
      .mockResolvedValue([artifact("art-a", RUN_A)]);
    const user = userEvent.setup();
    render(<ChatPanel />);

    expect(await screen.findByText("Image history could not be refreshed.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(boundGroups()).toHaveLength(1));
    expect(screen.queryByText("Image history could not be refreshed.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  describe("capability read failure", () => {
    it("after losing known capabilities shows the fixed notice and recovers with 'Check again'", async () => {
      setup({ capabilities: CAPS_FULL, artifacts: [artifact("art-a", RUN_A)] });
      const user = userEvent.setup();
      render(<ChatPanel />);
      await waitFor(() => expect(boundGroups()).toHaveLength(1));
      expect(screen.getByRole("button", { name: "Generate image" })).toBeTruthy();

      getConfig.mockRejectedValueOnce(new Error("config down"));
      await act(async () => h.reconnectHandler?.());

      expect((await screen.findByRole("status")).textContent).toBe(
        "Image history could not be checked."
      );
      expect(boundGroups()).toHaveLength(0);
      // Unknown never enables generation; the label is not "Retry" (matrix test queries /retry/i).
      expect(screen.queryByRole("button", { name: "Generate image" })).toBeNull();
      expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Check again" }));
      await waitFor(() => expect(boundGroups()).toHaveLength(1));
      expect(screen.queryByText("Image history could not be checked.")).toBeNull();
      expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
      expect(screen.getByRole("button", { name: "Generate image" })).toBeTruthy();
    });

    it("when the first read ever fails: truthful notice, no listing, no generation, independent of chat readiness; Check again loads the history", async () => {
      setup({ capabilities: CAPS_FULL, artifacts: [artifact("art-a", RUN_A)], canInfer: false });
      getConfig.mockReset().mockRejectedValueOnce(new Error("config down"));
      getConfig.mockResolvedValue({ capabilities: CAPS_FULL });
      const user = userEvent.setup();
      render(<ChatPanel />);

      await screen.findByText("second answer");
      expect(await screen.findByText("Image history could not be checked.")).toBeTruthy();
      expect(listAllArtifacts).not.toHaveBeenCalled();
      expect(screen.queryByText(/Loading images/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Generate image" })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Check again" }));
      await waitFor(() => expect(boundGroups()).toHaveLength(1));
      expect(screen.queryByText("Image history could not be checked.")).toBeNull();
      // canInfer=false: the chat provider is not ready, yet image history and generation work.
      expect(screen.getByRole("button", { name: "Generate image" })).toBeTruthy();
    });

    it("stays silent when the gateway is known to have no readers (not a read failure)", async () => {
      setup({ capabilities: CAPS_GENERATION_ONLY });
      render(<ChatPanel />);
      await screen.findByRole("button", { name: "Generate image" });
      expect(screen.queryByText("Image history could not be checked.")).toBeNull();
      expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
    });

    describe("focus after a successful recovery", () => {
      async function loseCapabilities(capabilities: Record<string, unknown>) {
        setup({ capabilities, artifacts: [artifact("art-a", RUN_A)] });
        render(<ChatPanel />);
        await waitFor(() => expect(boundGroups()).toHaveLength(1));
        getConfig.mockRejectedValueOnce(new Error("config down"));
        await act(async () => h.reconnectHandler?.());
        await screen.findByText("Image history could not be checked.");
      }

      it("'Check again' hands focus to the Generate trigger when generation is advertised", async () => {
        const user = userEvent.setup();
        await loseCapabilities(CAPS_FULL);
        await user.click(screen.getByRole("button", { name: "Check again" }));

        const trigger = await screen.findByRole("button", { name: "Generate image" });
        await waitFor(() => expect(document.activeElement).toBe(trigger));
      });

      it("'Check again' hands focus to the chat heading when there is no Generate action", async () => {
        const user = userEvent.setup();
        await loseCapabilities(CAPS_READERS_ONLY);
        await user.click(screen.getByRole("button", { name: "Check again" }));

        await waitFor(() => expect(boundGroups()).toHaveLength(1));
        const heading = document.querySelector("[data-chat-heading]");
        expect(heading?.textContent).toBe("Chat");
        await waitFor(() => expect(document.activeElement).toBe(heading));
      });

      it("leaves focus alone when it moved to the chat input before the check finished", async () => {
        const user = userEvent.setup();
        await loseCapabilities(CAPS_FULL);
        let release: (value: unknown) => void = () => {};
        getConfig.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
        await user.click(screen.getByRole("button", { name: "Check again" }));
        const composer = screen.getByPlaceholderText("Message eigen-air...");
        composer.focus();

        await act(async () => release({ capabilities: CAPS_FULL }));
        await waitFor(() => expect(boundGroups()).toHaveLength(1));
        await screen.findByRole("button", { name: "Generate image" });
        expect(document.activeElement).toBe(composer);
      });

      it("a check that fails again puts focus back on the reappearing button", async () => {
        const user = userEvent.setup();
        await loseCapabilities(CAPS_FULL);
        getConfig.mockRejectedValueOnce(new Error("still down"));
        await user.click(screen.getByRole("button", { name: "Check again" }));

        await waitFor(() =>
          expect(document.activeElement).toBe(screen.getByRole("button", { name: "Check again" }))
        );
      });

      it("listing 'Retry' hands focus to the chat heading once the listing loaded", async () => {
        setup({ capabilities: CAPS_READERS_ONLY });
        listAllArtifacts
          .mockRejectedValueOnce(new ArtifactAdapterError("not_found"))
          .mockResolvedValue([artifact("art-a", RUN_A)]);
        const user = userEvent.setup();
        render(<ChatPanel />);
        const retry = await screen.findByRole("button", { name: "Retry" });
        await user.click(retry);

        await waitFor(() => expect(boundGroups()).toHaveLength(1));
        await waitFor(() =>
          expect(document.activeElement).toBe(document.querySelector("[data-chat-heading]"))
        );
      });
    });
  });

  describe("Generate image action (real DirectImageTemplateAction)", () => {
    it.each([true, false])(
      "is absent when generation is not advertised (chat canInfer=%s)",
      async (canInfer) => {
        setup({ capabilities: CAPS_READERS_ONLY, canInfer, artifacts: [artifact("a", RUN_A)] });
        render(<ChatPanel />);

        await waitFor(() => expect(boundGroups()).toHaveLength(1));
        expect(screen.queryByRole("button", { name: "Generate image" })).toBeNull();
      }
    );

    it.each([true, false])(
      "is present when generation is advertised even if chat canInfer=%s, independent of readers",
      async (canInfer) => {
        setup({ capabilities: CAPS_GENERATION_ONLY, canInfer });
        render(<ChatPanel />);

        expect(await screen.findByRole("button", { name: "Generate image" })).toBeTruthy();
      }
    );

    async function openPanel(user: UserEvent) {
      const trigger = await screen.findByRole("button", { name: "Generate image" });
      await user.click(trigger);
      const region = await screen.findByRole("region", { name: "Generate image" });
      await screen.findByRole("combobox", { name: "Template" });
      return { trigger, region };
    }

    async function submitPrompt(user: UserEvent, prompt = "a red fox") {
      await user.type(screen.getByRole("textbox", { name: "Prompt" }), prompt);
      await user.click(screen.getByRole("button", { name: "Generate" }));
    }

    it("toggles the panel, returns focus to the trigger on explicit close, and closes on session change without stealing focus", async () => {
      setup({ capabilities: CAPS_FULL });
      const user = userEvent.setup();
      render(<ChatPanel />);

      const { trigger } = await openPanel(user);
      expect(trigger.getAttribute("aria-expanded")).toBe("true");

      await user.click(screen.getByRole("button", { name: "Close image generator" }));
      expect(screen.queryByRole("region", { name: "Generate image" })).toBeNull();
      expect(document.activeElement).toBe(trigger);

      await user.click(trigger);
      await screen.findByRole("region", { name: "Generate image" });
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("region", { name: "Generate image" })).toBeNull();
      expect(document.activeElement).toBe(trigger);

      await user.click(trigger);
      await screen.findByRole("region", { name: "Generate image" });
      await user.click(trigger);
      expect(screen.queryByRole("region", { name: "Generate image" })).toBeNull();

      // Session change: the panel closes, and focus the user already moved is left alone.
      await user.click(trigger);
      await screen.findByRole("region", { name: "Generate image" });
      const composer = screen.getByPlaceholderText("Message eigen-air...");
      composer.focus();
      act(() => useConnectionStore.setState({ sessionId: "session-2" }));
      await waitFor(() =>
        expect(screen.queryByRole("region", { name: "Generate image" })).toBeNull()
      );
      expect(document.activeElement).toBe(composer);
    });

    it("keeps keyboard focus inside the panel after submitting (never on <body>) so Escape still closes it", async () => {
      setup({ capabilities: CAPS_FULL });
      const user = userEvent.setup();
      render(<ChatPanel />);
      const { trigger, region } = await openPanel(user);

      await submitPrompt(user);

      await waitFor(() => expect(createJob).toHaveBeenCalledTimes(1));
      await screen.findByText(/Queued/);
      expect(document.activeElement).not.toBe(document.body);
      expect(region.contains(document.activeElement)).toBe(true);

      await user.keyboard("{Escape}");
      expect(screen.queryByRole("region", { name: "Generate image" })).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it("keeps the same job's status and Cancel reachable after close/reopen, and does not offer a duplicate submit", async () => {
      setup({ capabilities: CAPS_FULL });
      const user = userEvent.setup();
      render(<ChatPanel />);
      const { trigger } = await openPanel(user);
      await submitPrompt(user);
      await screen.findByRole("button", { name: "Cancel" });

      await user.click(screen.getByRole("button", { name: "Close image generator" }));
      expect(screen.queryByRole("region", { name: "Generate image" })).toBeNull();
      await user.click(trigger);
      const region = await screen.findByRole("region", { name: "Generate image" });

      expect(within(region).getByText(/Queued/)).toBeTruthy();
      expect(within(region).getByRole("button", { name: "Cancel" })).toBeTruthy();
      expect(
        (within(region).getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled
      ).toBe(true);
      expect(createJob).toHaveBeenCalledTimes(1);
    });

    it("a createJob that resolves after close is still tracked for this session and never leaks into another one", async () => {
      setup({ capabilities: CAPS_FULL });
      let resolveJob: (job: ImageJobSnapshot) => void = () => {};
      createJob.mockReturnValue(new Promise<ImageJobSnapshot>((resolve) => (resolveJob = resolve)));
      const user = userEvent.setup();
      render(<ChatPanel />);
      const { trigger } = await openPanel(user);
      await submitPrompt(user);
      await waitFor(() => expect(createJob).toHaveBeenCalledTimes(1));

      await user.click(screen.getByRole("button", { name: "Close image generator" }));
      await act(async () => resolveJob(directJob()));

      // Same session, reopened: the late result is shown (tracked), not lost.
      await user.click(trigger);
      let region = await screen.findByRole("region", { name: "Generate image" });
      expect(await within(region).findByText(/Queued/)).toBeTruthy();
      await user.click(within(region).getByRole("button", { name: "Close image generator" }));

      // Another session never shows the first session's job.
      act(() => useConnectionStore.setState({ sessionId: "session-2" }));
      await act(async () => {});
      await user.click(await screen.findByRole("button", { name: "Generate image" }));
      region = await screen.findByRole("region", { name: "Generate image" });
      await screen.findByRole("combobox", { name: "Template" });
      expect(within(region).queryByText(/Queued/)).toBeNull();
      expect(within(region).queryByRole("button", { name: "Cancel" })).toBeNull();
    });

    describe("draft (memory only, owned by the surviving action)", () => {
      const typeDraft = async (user: UserEvent) => {
        await user.type(screen.getByRole("textbox", { name: "Prompt" }), "a red fox");
        await user.type(screen.getByLabelText("Negative prompt (optional)"), "blurry");
        await user.selectOptions(screen.getByLabelText("Quality"), "high");
      };
      const expectDraft = (prompt: string) => {
        expect((screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement).value).toBe(
          prompt
        );
      };

      it("survives Escape and the Close button, is dropped on session change, and never touches web storage", async () => {
        setup({ capabilities: CAPS_FULL });
        const user = userEvent.setup();
        render(<ChatPanel />);
        const { trigger } = await openPanel(user);
        const setItem = vi.spyOn(Storage.prototype, "setItem");
        await typeDraft(user);

        await user.keyboard("{Escape}");
        expect(screen.queryByRole("region", { name: "Generate image" })).toBeNull();
        await user.click(trigger);
        await screen.findByRole("combobox", { name: "Template" });
        expectDraft("a red fox");
        expect(
          (screen.getByLabelText("Negative prompt (optional)") as HTMLTextAreaElement).value
        ).toBe("blurry");
        expect((screen.getByLabelText("Quality") as HTMLSelectElement).value).toBe("high");

        await user.click(screen.getByRole("button", { name: "Close image generator" }));
        await user.click(trigger);
        await screen.findByRole("combobox", { name: "Template" });
        expectDraft("a red fox");
        expect(setItem).not.toHaveBeenCalled();
        setItem.mockRestore();

        // Another session (and coming back to the first one) starts empty.
        act(() => useConnectionStore.setState({ sessionId: "session-2" }));
        await waitFor(() =>
          expect(screen.queryByRole("region", { name: "Generate image" })).toBeNull()
        );
        await openPanel(user);
        expectDraft("");
        await user.keyboard("{Escape}");
        act(() => useConnectionStore.setState({ sessionId: "session-1" }));
        await openPanel(user);
        expectDraft("");
      });

      it("is cleared by a successful submit but kept by a failed one", async () => {
        setup({ capabilities: CAPS_FULL });
        createJob.mockRejectedValueOnce(new ArtifactAdapterError("network"));
        const user = userEvent.setup();
        render(<ChatPanel />);
        const { trigger } = await openPanel(user);
        await submitPrompt(user);
        await screen.findByRole("alert");
        await user.keyboard("{Escape}");
        await user.click(trigger);
        await screen.findByRole("combobox", { name: "Template" });
        expectDraft("a red fox");

        await user.click(screen.getByRole("button", { name: "Generate" }));
        await screen.findByText(/Queued/);
        expectDraft("");
        await user.keyboard("{Escape}");
        await user.click(trigger);
        await screen.findByRole("combobox", { name: "Template" });
        expectDraft("");
      });

      it("never leaks draft text into labels, live regions or error strings", async () => {
        const TOKEN = "zq-private-draft-token";
        setup({ capabilities: CAPS_FULL });
        createJob.mockRejectedValueOnce(new Error(TOKEN));
        const user = userEvent.setup();
        render(<ChatPanel />);
        await openPanel(user);
        await submitPrompt(user, TOKEN);
        expect((await screen.findByRole("alert")).textContent).toBe(
          "Something went wrong. Try again."
        );

        for (const element of document.querySelectorAll("*")) {
          for (const attribute of element.attributes) expect(attribute.value).not.toContain(TOKEN);
        }
        for (const live of document.querySelectorAll(
          '[role="alert"],[role="status"],[aria-live]'
        )) {
          expect(live.textContent).not.toContain(TOKEN);
        }
      });
    });
  });

  describe("reading position", () => {
    function installViewport() {
      const viewport = document.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
      if (!viewport) throw new Error("scroll viewport not rendered");
      const metrics = { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 };
      for (const key of ["scrollTop", "scrollHeight", "clientHeight"] as const) {
        Object.defineProperty(viewport, key, {
          configurable: true,
          get: () => metrics[key],
          set: (value: number) => {
            metrics[key] = value;
          },
        });
      }
      return {
        metrics,
        scrollTo(top: number) {
          metrics.scrollTop = top;
          act(() => {
            viewport.dispatchEvent(new Event("scroll"));
          });
        },
        grow() {
          act(() => {
            for (const observer of ResizeObserverMock.instances) observer.fire();
          });
        },
      };
    }

    it("keeps following the bottom when previews grow while the reader is at the bottom", async () => {
      setup({ capabilities: CAPS_READERS_ONLY, artifacts: [artifact("art-a", RUN_A)] });
      render(<ChatPanel />);
      await waitFor(() => expect(boundGroups()).toHaveLength(1));
      const view = installViewport();

      view.scrollTo(1500); // 2000 - 1500 - 500 = 0 from the bottom
      view.metrics.scrollHeight = 2400; // a preview finished loading below
      view.grow();

      expect(view.metrics.scrollTop).toBe(2400);
    });

    it("never pulls a reader who scrolled up back to the newest content when previews grow", async () => {
      setup({ capabilities: CAPS_READERS_ONLY, artifacts: [artifact("art-a", RUN_A)] });
      render(<ChatPanel />);
      await waitFor(() => expect(boundGroups()).toHaveLength(1));
      const view = installViewport();

      view.scrollTo(200); // far above the bottom
      view.metrics.scrollHeight = 2600;
      view.grow();

      expect(view.metrics.scrollTop).toBe(200);

      // Back near the bottom (within the threshold): following resumes.
      view.scrollTo(2600 - 500 - 20);
      view.metrics.scrollHeight = 2900;
      view.grow();
      expect(view.metrics.scrollTop).toBe(2900);
    });
  });

  it("keeps image hints out of chat message handling and only refetches the listing", async () => {
    setup({ capabilities: CAPS_READERS_ONLY, artifacts: [artifact("art-a", RUN_A)] });
    h.sendMessage.mockImplementation(
      (_msg: string, _session: string, onEvent: (event: unknown) => void) => {
        h.onEvent = onEvent;
        return new Promise(() => {});
      }
    );
    const user = userEvent.setup();
    render(<ChatPanel />);
    await waitFor(() => expect(boundGroups()).toHaveLength(1));
    await waitFor(() => expect(h.hintHandler).toBeDefined());

    await user.type(screen.getByPlaceholderText("Message eigen-air..."), "draw");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(h.onEvent).toBeDefined());
    act(() => h.onEvent?.({ type: "event", event: "chunk", payload: { content: "partial" } }));
    expect(useChatStore.getState().streamingContent).toBe("partial");

    const before = {
      messages: structuredClone(useChatStore.getState().messages),
      streaming: useChatStore.getState().streamingContent,
      status: useChatStore.getState().streamStatus,
    };
    const listings = listAllArtifacts.mock.calls.length;
    const hint = {
      type: "event",
      version: "v1",
      event: "image_artifact.committed",
      session_id: "session-1",
      run_id: RUN_A,
      payload: { artifact_id: "art-new", job_id: "job-1" },
    };
    // Through the per-turn callback (must be inert) and through the dedicated hint channel.
    act(() => h.onEvent?.(hint));
    act(() => h.hintHandler?.(hint));
    act(() => h.hintHandler?.({ invalid: true }));

    await waitFor(() => expect(listAllArtifacts.mock.calls.length).toBeGreaterThan(listings));
    const after = useChatStore.getState();
    expect(after.messages).toEqual(before.messages);
    expect(after.streamingContent).toBe(before.streaming);
    expect(after.streamStatus).toBe(before.status);
    expect(after.streamError).toBeNull();
    expect(after.isStreaming).toBe(true);
  });
});
