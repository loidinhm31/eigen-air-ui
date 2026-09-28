// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  setMemoryService,
  setVaultKnowledgeService,
} from "../../adapters/factory/ServiceFactory.js";
import type { IMemoryService } from "../../adapters/factory/interfaces/IMemoryService.js";
import type { IVaultKnowledgeService } from "../../adapters/factory/interfaces/IVaultKnowledgeService.js";
import { MemoryPage } from "./MemoryPage.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MemoryPage deep-link focus integration", () => {
  let mockMemory: IMemoryService;
  let mockKnowledge: IVaultKnowledgeService;

  beforeEach(() => {
    mockMemory = {
      list: vi.fn().mockResolvedValue([{ key: "user_name", value: "Alice" }]),
      store: vi.fn().mockResolvedValue(undefined),
      recall: vi.fn().mockResolvedValue(null),
      search: vi.fn().mockResolvedValue([]),
      forget: vi.fn().mockResolvedValue(undefined),
      listEpisodes: vi.fn().mockResolvedValue([]),
      getEpisode: vi.fn().mockImplementation(async (id: string) => ({
        id,
        scope: { tenant_id: "t1", user_id: "u1", agent_id: "a1" },
        input: "deep linked input",
        output: "deep linked output",
        summary: "deep linked summary",
        created_at: 5000,
      })),
      updateEpisode: vi.fn(),
      deleteEpisode: vi.fn(),
    };

    mockKnowledge = {
      listVaultItems: vi.fn().mockResolvedValue([]),
      createVaultItem: vi.fn(),
      getVaultItem: vi.fn().mockResolvedValue(null),
      deleteVaultItem: vi.fn().mockResolvedValue(undefined),
      listKnowledgeFacts: vi.fn().mockResolvedValue([]),
      listKnowledgeRelations: vi.fn().mockResolvedValue([]),
    };

    setMemoryService(mockMemory);
    setVaultKnowledgeService(mockKnowledge);
  });

  it("renders MemoryBrowser and EpisodeBrowser without focus by default", async () => {
    render(
      <MemoryRouter initialEntries={["/memory"]}>
        <Routes>
          <Route path="/memory" element={<MemoryPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Working memory")).toBeDefined();
    expect(await screen.findByText("Episodes")).toBeDefined();
    expect(screen.queryByTestId("focused-episode-container")).toBeNull();
  });

  it("extracts ?episode_id= from URL and focuses EpisodeBrowser", async () => {
    render(
      <MemoryRouter initialEntries={["/memory?episode_id=ep-deep-42"]}>
        <Routes>
          <Route path="/memory" element={<MemoryPage />} />
        </Routes>
      </MemoryRouter>
    );

    const container = await screen.findByTestId("focused-episode-container");
    expect(within(container).getByText("Lineage focus")).toBeDefined();
    expect(within(container).getAllByText("ep-deep-42").length).toBeGreaterThanOrEqual(1);
    expect(mockMemory.getEpisode).toHaveBeenCalledWith("ep-deep-42", expect.any(Object));
  });

  it("clears URL focus when Show all episodes is clicked", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/memory?episode_id=ep-deep-42"]}>
        <Routes>
          <Route path="/memory" element={<MemoryPage />} />
        </Routes>
      </MemoryRouter>
    );

    const clearBtn = await screen.findByRole("button", { name: "Show all episodes" });
    await user.click(clearBtn);

    expect(screen.queryByTestId("focused-episode-container")).toBeNull();
  });

  it("honors direct episodeId prop override", async () => {
    render(
      <MemoryRouter initialEntries={["/memory"]}>
        <Routes>
          <Route path="/memory" element={<MemoryPage episodeId="ep-prop-override" />} />
        </Routes>
      </MemoryRouter>
    );

    const container = await screen.findByTestId("focused-episode-container");
    expect(within(container).getAllByText("ep-prop-override").length).toBeGreaterThanOrEqual(1);
  });
});
