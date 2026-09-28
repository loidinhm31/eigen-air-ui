// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RunMemoryLineageDto } from "@eigen-air-ui/shared/types";
import {
  MemoryLineagePanel,
  formatMemoryTier,
  formatLineageRelation,
  resolveLineageNavigationTarget,
} from "./MemoryLineagePanel.js";

function makeLineageItem(overrides: Partial<RunMemoryLineageDto> = {}): RunMemoryLineageDto {
  return {
    lineage_seq: 1,
    relation: "used",
    memory_kind: "episode",
    memory_reference: "ep-42",
    tenant_id: "tenant-1",
    user_id: "user-1",
    workspace_id: "ws-1",
    agent_id: "agent-1",
    source_episode_id: null,
    provenance: "session/1",
    confidence: 0.85,
    occurred_at_ms: 1700000000000,
    ...overrides,
  };
}

describe("MemoryLineagePanel helper functions", () => {
  it("formats memory tiers correctly", () => {
    expect(formatMemoryTier("working")).toBe("working memory tier");
    expect(formatMemoryTier("episode")).toBe("episodic memory tier");
    expect(formatMemoryTier("fact")).toBe("knowledge fact tier");
  });

  it("formats lineage relations with truthful non-causal labeling for used", () => {
    expect(formatLineageRelation("used")).toBe("used (included in request)");
    expect(formatLineageRelation("considered")).toBe("considered");
    expect(formatLineageRelation("written")).toBe("written");
  });

  it("resolves navigation target for episodic memory kind with encoded id", () => {
    const item = makeLineageItem({
      memory_kind: "episode",
      memory_reference: "ep/123#test",
    });
    const target = resolveLineageNavigationTarget(item);
    expect(target).toEqual({
      path: "/memory?episode_id=ep%2F123%23test",
      label: "View episode source",
    });
  });

  it("resolves navigation target for fact kind with source_episode_id", () => {
    const item = makeLineageItem({
      memory_kind: "fact",
      memory_reference: "fact-99",
      source_episode_id: "ep-source-55",
    });
    const target = resolveLineageNavigationTarget(item);
    expect(target).toEqual({
      path: "/memory?episode_id=ep-source-55",
      label: "View source episode",
    });
  });

  it("returns null navigation target for fact kind when source_episode_id is absent", () => {
    const item = makeLineageItem({
      memory_kind: "fact",
      memory_reference: "fact-orphan",
      source_episode_id: null,
    });
    expect(resolveLineageNavigationTarget(item)).toBeNull();
  });

  it("resolves working memory target to /memory without coercing key into episode ID", () => {
    const item = makeLineageItem({
      memory_kind: "working",
      memory_reference: "user_preference_theme",
      source_episode_id: null,
    });
    const target = resolveLineageNavigationTarget(item);
    expect(target).toEqual({
      path: "/memory",
      label: "View working memory",
    });
    expect(target?.path).not.toContain("episode_id");
  });
});

describe("MemoryLineagePanel component", () => {
  it("renders empty message when lineage is empty", () => {
    render(<MemoryLineagePanel lineage={[]} />);
    expect(screen.getByText("No memory relation was reported by the server.")).toBeDefined();
  });

  it("renders lineage items with tier label, heuristic confidence, and navigation button", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    const items: RunMemoryLineageDto[] = [
      makeLineageItem({
        lineage_seq: 1,
        relation: "used",
        memory_kind: "episode",
        memory_reference: "ep-alpha",
        confidence: 0.92,
      }),
      makeLineageItem({
        lineage_seq: 2,
        relation: "considered",
        memory_kind: "fact",
        memory_reference: "fact-beta",
        source_episode_id: "ep-source-beta",
        confidence: null,
      }),
      makeLineageItem({
        lineage_seq: 3,
        relation: "written",
        memory_kind: "working",
        memory_reference: "working-gamma",
        confidence: undefined,
      }),
    ];

    render(<MemoryLineagePanel lineage={items} onNavigate={onNavigate} />);

    expect(screen.getByText("3 loaded")).toBeDefined();
    expect(screen.getByText("used (included in request)")).toBeDefined();
    expect(screen.getByText("episodic memory tier")).toBeDefined();
    expect(screen.getByText(/heuristic confidence 0\.92/)).toBeDefined();

    expect(screen.getByText("considered")).toBeDefined();
    expect(screen.getByText("knowledge fact tier")).toBeDefined();

    expect(screen.getByText("written")).toBeDefined();
    expect(screen.getByText("working memory tier")).toBeDefined();

    // Episode drill-down button
    const epBtn = screen.getByRole("button", { name: "View episode source for ep-alpha" });
    await user.click(epBtn);
    expect(onNavigate).toHaveBeenCalledWith("/memory?episode_id=ep-alpha");

    // Fact source drill-down button
    const factBtn = screen.getByRole("button", { name: "View source episode for fact-beta" });
    await user.click(factBtn);
    expect(onNavigate).toHaveBeenCalledWith("/memory?episode_id=ep-source-beta");

    // Working memory navigation button
    const workingBtn = screen.getByRole("button", { name: "View working memory for working-gamma" });
    await user.click(workingBtn);
    expect(onNavigate).toHaveBeenCalledWith("/memory");
  });

  it("renders load more button and triggers callback", async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();

    render(
      <MemoryLineagePanel
        lineage={[makeLineageItem()]}
        hasMore={true}
        onLoadMore={onLoadMore}
        error="Lineage fetch warning"
      />
    );

    expect(screen.getByRole("alert").textContent).toBe("Lineage fetch warning");
    const loadBtn = screen.getByRole("button", { name: "Load more memory lineage" });
    await user.click(loadBtn);
    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});
