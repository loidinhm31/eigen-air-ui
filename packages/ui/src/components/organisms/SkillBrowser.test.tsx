// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SkillBrowser } from "./SkillBrowser.js";
import { SkillHttpError } from "../../adapters/http/HttpSkillAdapter.js";
import type {
  Skill,
  SkillPackageDetailDTO,
  SkillResourceResponse,
} from "@eigen-air-ui/shared/types";
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const mockService = {
  list: vi.fn(),
  search: vi.fn(),
  get: vi.fn(),
  importPackage: vi.fn(),
  replacePackage: vi.fn(),
  setEnabled: vi.fn(),
  uninstall: vi.fn(),
  getResource: vi.fn(),
};

vi.mock("../../adapters/factory/ServiceFactory.js", () => ({
  getSkillService: () => mockService,
}));

const SAMPLE_IMPORTED_SKILL: Skill = {
  id: "qwen-image-local",
  name: "qwen-image-local",
  description: "Curated Qwen image generation guidance",
  tags: ["image", "illustration"],
  version: "1.0.4-eigen-air.1",
  source: "imported",
  format: "markdown",
  install_id: "install-uuid-1",
  content_revision: "sha256-content-rev-1",
  local_state_revision: 1,
  enabled: false,
  compatibility: "native",
  eligibility: "disabled",
  required_tools: ["local_image"],
  optional_tools: ["read_skill_resource"],
};

const SAMPLE_DETAIL: SkillPackageDetailDTO = {
  ...SAMPLE_IMPORTED_SKILL,
  system_prompt: "# Qwen Instructions\nUse local_image tool.",
  resources: [
    {
      path: "REFERENCE.md",
      size: 1024,
      sha256: "sha256-ref-1",
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.clearAllMocks();
  mockService.list.mockResolvedValue([SAMPLE_IMPORTED_SKILL]);
  mockService.get.mockResolvedValue(SAMPLE_DETAIL);
  mockService.search.mockResolvedValue([]);
  mockService.setEnabled.mockResolvedValue({
    ...SAMPLE_IMPORTED_SKILL,
    enabled: true,
    local_state_revision: 2,
    eligibility: "selectable",
  });
  mockService.importPackage.mockResolvedValue(SAMPLE_IMPORTED_SKILL);
  mockService.replacePackage.mockResolvedValue({
    ...SAMPLE_IMPORTED_SKILL,
    content_revision: "sha256-content-rev-2",
  });
  mockService.uninstall.mockResolvedValue(undefined);
  mockService.getResource.mockResolvedValue({
    path: "REFERENCE.md",
    content: "# Reference Content\nDetailed guidelines.",
    size: 42,
    truncated: false,
  } as SkillResourceResponse);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SkillBrowser component", () => {
  it("renders skills list and badges on mount", async () => {
    render(<SkillBrowser />);

    expect(await screen.findByText("qwen-image-local")).toBeTruthy();
    expect(screen.getByText("v1.0.4-eigen-air.1")).toBeTruthy();
    expect(screen.getByText("Imported")).toBeTruthy();
    expect(screen.getByText(/markdown/i)).toBeTruthy();
    expect(screen.getByText("Native")).toBeTruthy();
    expect(screen.getByText("Disabled")).toBeTruthy();
  });

  it("handles search input and queries search endpoint", async () => {
    const user = userEvent.setup();
    mockService.search.mockResolvedValueOnce([
      {
        ...SAMPLE_IMPORTED_SKILL,
        name: "searched-skill",
        id: "searched-skill",
      },
    ]);
    render(<SkillBrowser />);

    await screen.findByText("qwen-image-local");

    const searchInput = screen.getByPlaceholderText("Search skills (BM25)...");
    await user.type(searchInput, "searched{enter}");

    await waitFor(() => {
      expect(mockService.search).toHaveBeenCalledWith("searched");
    });
    expect(await screen.findByText("searched-skill")).toBeTruthy();
  });

  it("uploads a package file and opens the inspection panel automatically", async () => {
    const user = userEvent.setup();
    render(<SkillBrowser />);

    await screen.findByText("qwen-image-local");

    const file = new File([new Uint8Array([1, 2, 3])], "test-skill.skill", {
      type: "application/zip",
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(mockService.importPackage).toHaveBeenCalledTimes(1);
      expect(mockService.get).toHaveBeenCalledWith("qwen-image-local");
    });

    // Verify inspection panel is visible
    expect(await screen.findByText("Inert Package Resources")).toBeTruthy();
    expect(screen.getByText("Package Resources (1)")).toBeTruthy();
    expect(screen.getByText("Enable for this runtime")).toBeTruthy();
  });

  it("displays an error alert on upload collision or quota exceeded", async () => {
    const user = userEvent.setup();
    mockService.importPackage.mockRejectedValueOnce(
      new SkillHttpError(409, "conflict", "A skill with this ID already exists", "skill_id_collision")
    );
    render(<SkillBrowser />);

    await screen.findByText("qwen-image-local");

    const file = new File([new Uint8Array([1, 2, 3])], "duplicate.skill", {
      type: "application/zip",
    });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;

    await user.upload(fileInput, file);

    expect(
      await screen.findByText(/A skill with this ID already exists or an import is currently in progress/)
    ).toBeTruthy();
  });

  it("previews a package resource inside the inspection modal", async () => {
    const user = userEvent.setup();
    render(<SkillBrowser />);

    const inspectBtn = await screen.findByRole("button", { name: "Inspect" });
    await user.click(inspectBtn);

    expect(await screen.findByText("Package Resources (1)")).toBeTruthy();

    const previewBtn = screen.getByRole("button", { name: "Preview" });
    await user.click(previewBtn);

    await waitFor(() => {
      expect(mockService.getResource).toHaveBeenCalledWith(
        "qwen-image-local",
        "REFERENCE.md",
        expect.objectContaining({
          contentRevision: "sha256-content-rev-1",
          installId: "install-uuid-1",
        })
      );
    });

    expect(await screen.findByText(/# Reference Content/)).toBeTruthy();
  });

  it("enables skill for this runtime from inspection modal", async () => {
    const user = userEvent.setup();
    render(<SkillBrowser />);

    const inspectBtn = await screen.findByRole("button", { name: "Inspect" });
    await user.click(inspectBtn);

    const enableBtn = await screen.findByRole("button", { name: "Enable for this runtime" });
    await user.click(enableBtn);

    await waitFor(() => {
      expect(mockService.setEnabled).toHaveBeenCalledWith("qwen-image-local", true, {
        localRevision: 1,
        installId: "install-uuid-1",
        inspectedRevision: "sha256-content-rev-1",
      });
    });
  });

  it("routes enable intent through inspection from card checkbox", async () => {
    const user = userEvent.setup();
    render(<SkillBrowser />);

    const checkbox = (await screen.findByRole("checkbox", {
      name: "Enable qwen-image-local for current runtime",
    })) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    await user.click(checkbox);

    await waitFor(() => {
      expect(mockService.get).toHaveBeenCalledWith("qwen-image-local");
    });
    expect(await screen.findByText("Enable for this runtime")).toBeTruthy();
  });

  it("allows direct disabling from card when skill is currently enabled", async () => {
    mockService.list.mockResolvedValueOnce([
      {
        ...SAMPLE_IMPORTED_SKILL,
        enabled: true,
        eligibility: "selectable",
        local_state_revision: 2,
      },
    ]);
    const user = userEvent.setup();
    render(<SkillBrowser />);

    const enabledCheckbox = (await screen.findByRole("checkbox", {
      name: "Enable qwen-image-local for current runtime",
    })) as HTMLInputElement;
    expect(enabledCheckbox.checked).toBe(true);

    await user.click(enabledCheckbox);

    await waitFor(() => {
      expect(mockService.setEnabled).toHaveBeenCalledWith("qwen-image-local", false, {
        localRevision: 2,
        installId: "install-uuid-1",
      });
    });
  });

  it("opens global uninstall modal and executes uninstall upon confirmation", async () => {
    const user = userEvent.setup();
    render(<SkillBrowser />);

    const uninstallBtn = await screen.findByRole("button", { name: "Uninstall" });
    await user.click(uninstallBtn);

    expect(
      await screen.findByText("Uninstall from shared HOME library")
    ).toBeTruthy();
    expect(
      screen.getByText(/All projects, daemons, and CLI sessions under this OS account will lose access/)
    ).toBeTruthy();

    const confirmBtn = screen.getByRole("button", { name: "Uninstall globally" });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockService.uninstall).toHaveBeenCalledWith("qwen-image-local", {
        contentRevision: "sha256-content-rev-1",
        installId: "install-uuid-1",
      });
    });
  });

  it("opens global replace modal and cancels safely", async () => {
    const user = userEvent.setup();
    render(<SkillBrowser />);

    const replaceBtn = await screen.findByRole("button", { name: "Replace" });
    await user.click(replaceBtn);

    expect(await screen.findByText("Replace Package: qwen-image-local")).toBeTruthy();
    expect(
      screen.getByText(/Replacing this package will update the shared HOME library for all daemons and CLI sessions/)
    ).toBeTruthy();

    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    await user.click(cancelBtn);

    expect(screen.queryByText("Replace Package: qwen-image-local")).toBeNull();
  });
});
