// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EpisodeUpdate, EpisodicMemory } from "@eigen-air-ui/shared/types";
import {
  setMemoryService,
  setVaultKnowledgeService,
} from "../../adapters/factory/ServiceFactory.js";
import type { IMemoryService } from "../../adapters/factory/interfaces/IMemoryService.js";
import type { IVaultKnowledgeService } from "../../adapters/factory/interfaces/IVaultKnowledgeService.js";
import { MemoryHttpError } from "../../adapters/http/HttpMemoryAdapter.js";
import { EpisodeBrowser } from "./EpisodeBrowser.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EpisodeBrowser focus state machine and error presentation", () => {
  const mockEpisodes: EpisodicMemory[] = [
    { id: "ep-1", scope: { tenant_id: "t1", user_id: "u1", agent_id: "a1" }, input: "user hello", output: "bot response", summary: "intro", created_at: 1000 },
    { id: "ep-2", scope: { tenant_id: "t1", user_id: "u1", agent_id: "a1" }, input: "user query", output: "bot answer", summary: "topic", created_at: 2000 },
  ];

  let mockMemory: IMemoryService;
  let mockKnowledge: IVaultKnowledgeService;

  beforeEach(() => {
    mockMemory = {
      list: vi.fn().mockResolvedValue([]),
      store: vi.fn().mockResolvedValue(undefined),
      recall: vi.fn().mockResolvedValue(null),
      search: vi.fn().mockResolvedValue([]),
      forget: vi.fn().mockResolvedValue(undefined),
      listEpisodes: vi.fn().mockResolvedValue(mockEpisodes),
      getEpisode: vi.fn().mockImplementation(async (id: string) => mockEpisodes.find((e) => e.id === id) ?? null),
      updateEpisode: vi.fn().mockImplementation(async (id: string, update: EpisodeUpdate) => {
        const ep = mockEpisodes.find((e) => e.id === id) ?? mockEpisodes[0];
        return { ...ep, ...update, summary: update.summary ?? "updated summary" };
      }),
      deleteEpisode: vi.fn().mockResolvedValue(undefined),
    };

    mockKnowledge = {
      listVaultItems: vi.fn().mockResolvedValue([]),
      createVaultItem: vi.fn(),
      getVaultItem: vi.fn().mockResolvedValue(null),
      deleteVaultItem: vi.fn().mockResolvedValue(undefined),
      listKnowledgeFacts: vi.fn().mockResolvedValue([
        { id: "f-1", subject: "user", predicate: "prefers", object: "Rust", source_episode_id: "ep-1", created_at_ms: 1000 },
      ]),
      listKnowledgeRelations: vi.fn().mockResolvedValue([]),
    };

    setMemoryService(mockMemory);
    setVaultKnowledgeService(mockKnowledge);
  });

  it("renders list of episodes when focusedEpisodeId is absent", async () => {
    render(<EpisodeBrowser />);
    expect(await screen.findByText("Episodes")).toBeDefined();
    expect(screen.getByText("ep-1")).toBeDefined();
    expect(screen.getByText("ep-2")).toBeDefined();
    expect(screen.queryByTestId("focused-episode-container")).toBeNull();
  });

  it("focuses authorized episode and only fetches facts after successful episode read", async () => {
    render(<EpisodeBrowser focusedEpisodeId="ep-1" />);

    const focusedContainer = await screen.findByTestId("focused-episode-container");
    expect(focusedContainer).toBeDefined();
    expect(within(focusedContainer).getByText("Lineage focus")).toBeDefined();
    expect(within(focusedContainer).getByText("Focused source")).toBeDefined();

    expect(mockMemory.getEpisode).toHaveBeenCalledWith("ep-1", expect.any(Object));

    await waitFor(() => {
      expect(mockKnowledge.listKnowledgeFacts).toHaveBeenCalledWith({ source_episode_id: "ep-1" });
    });
    expect(within(focusedContainer).getByText(/user prefers Rust/)).toBeDefined();
  });

  it("presents distinct source unavailable state when episode is not found (404/null)", async () => {
    vi.mocked(mockMemory.getEpisode).mockResolvedValueOnce(null);

    render(<EpisodeBrowser focusedEpisodeId="ep-missing" />);

    expect(await screen.findByText("Source unavailable")).toBeDefined();
    expect(screen.getByText(/The requested episode source does not exist, was deleted, or is not accessible/)).toBeDefined();

    expect(mockKnowledge.listKnowledgeFacts).not.toHaveBeenCalledWith({ source_episode_id: "ep-missing" });
  });

  it("presents access denied when getEpisode throws forbidden/unauthorized error", async () => {
    vi.mocked(mockMemory.getEpisode).mockRejectedValueOnce(
      new MemoryHttpError(403, "forbidden", "Scope permission denied")
    );

    render(<EpisodeBrowser focusedEpisodeId="ep-foreign" />);

    expect(await screen.findByText("Access denied")).toBeDefined();
    expect(screen.getByText("Scope permission denied")).toBeDefined();

    expect(mockKnowledge.listKnowledgeFacts).not.toHaveBeenCalledWith({ source_episode_id: "ep-foreign" });
  });

  it("presents retryable error when getEpisode fails with network/server error", async () => {
    const user = userEvent.setup();
    vi.mocked(mockMemory.getEpisode).mockRejectedValueOnce(
      new MemoryHttpError(500, "server_error", "Database connection lost")
    );

    render(<EpisodeBrowser focusedEpisodeId="ep-1" />);

    expect(await screen.findByText("Failed to load episode")).toBeDefined();
    expect(screen.getByText("Database connection lost")).toBeDefined();

    const retryBtn = screen.getByRole("button", { name: "Retry" });
    vi.mocked(mockMemory.getEpisode).mockResolvedValueOnce(mockEpisodes[0]);
    await user.click(retryBtn);

    expect(await screen.findByText("Focused source")).toBeDefined();
  });

  it("invokes onClearFocus when Show all episodes is clicked", async () => {
    const user = userEvent.setup();
    const onClearFocus = vi.fn();

    render(<EpisodeBrowser focusedEpisodeId="ep-1" onClearFocus={onClearFocus} />);
    const clearBtn = await screen.findByRole("button", { name: "Show all episodes" });
    await user.click(clearBtn);

    expect(onClearFocus).toHaveBeenCalledOnce();
  });

  it("handles sensitive transcript edit rejection", async () => {
    const user = userEvent.setup();
    vi.mocked(mockMemory.updateEpisode).mockRejectedValueOnce(
      new MemoryHttpError(400, "sensitive_content", "Sensitive transcript edits are rejected")
    );

    render(<EpisodeBrowser focusedEpisodeId="ep-1" />);
    await screen.findByTestId("focused-episode-container");

    const saveBtn = screen.getAllByRole("button", { name: "Save transcript" })[0];
    await user.click(saveBtn);

    expect(await screen.findByText("Sensitive transcript edits are rejected")).toBeDefined();
  });
  it("cancels deletion when window.confirm returns false, deletes when true", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");

    confirmSpy.mockReturnValueOnce(false);
    render(<EpisodeBrowser focusedEpisodeId="ep-1" />);
    await screen.findByTestId("focused-episode-container");

    const deleteBtn = screen.getAllByRole("button", { name: "Delete episode" })[0];
    await user.click(deleteBtn);
    expect(mockMemory.deleteEpisode).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    await user.click(deleteBtn);
    expect(mockMemory.deleteEpisode).toHaveBeenCalledWith("ep-1");
  });

  it("fences stale episode lookup responses across rapid id switches", async () => {
    let resolveSlow!: (value: EpisodicMemory | null) => void;
    const slowPromise = new Promise<EpisodicMemory | null>((resolve) => {
      resolveSlow = resolve;
    });

    vi.mocked(mockMemory.getEpisode).mockImplementation(async (id: string) => {
      if (id === "ep-slow") return slowPromise;
      return mockEpisodes[1];
    });

    const { rerender } = render(<EpisodeBrowser focusedEpisodeId="ep-slow" />);
    expect(screen.getByText(/Loading episode ep-slow/)).toBeDefined();

    rerender(<EpisodeBrowser focusedEpisodeId="ep-2" />);
    const container = await screen.findByTestId("focused-episode-container");
    expect(within(container).getAllByText("ep-2").length).toBeGreaterThanOrEqual(1);

    resolveSlow(mockEpisodes[0]);
    await new Promise((r) => setTimeout(r, 20));

    expect(within(container).getAllByText("ep-2").length).toBeGreaterThanOrEqual(1);
  });
});
