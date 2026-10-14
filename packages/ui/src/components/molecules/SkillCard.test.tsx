// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SkillCard } from "./SkillCard.js";
import type { Skill } from "@eigen-air-ui/shared/types";

afterEach(() => {
  cleanup();
});

describe("SkillCard component", () => {
  it("renders imported native skill badges and action buttons", () => {
    const skill: Skill = {
      id: "qwen-image-local",
      name: "qwen-image-local",
      description: "Qwen local image guidance",
      tags: ["image", "illustration"],
      version: "1.0.4-eigen-air.1",
      source: "imported",
      format: "markdown",
      enabled: false,
      compatibility: "native",
      eligibility: "disabled",
      required_tools: ["local_image"],
    };

    render(
      <SkillCard
        skill={skill}
        onInspect={vi.fn()}
        onToggleEnable={vi.fn()}
        onReplace={vi.fn()}
        onUninstall={vi.fn()}
      />
    );

    expect(screen.getByText("qwen-image-local")).toBeTruthy();
    expect(screen.getByText("v1.0.4-eigen-air.1")).toBeTruthy();
    expect(screen.getByText("Imported")).toBeTruthy();
    expect(screen.getByText(/markdown/i)).toBeTruthy();
    expect(screen.getByText("Native")).toBeTruthy();
    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.getByText("local_image")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Inspect" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Uninstall" })).toBeTruthy();
  });

  it("renders bundled skill without replace or uninstall buttons", () => {
    const skill: Skill = {
      id: "builtin_image",
      name: "builtin_image",
      description: "Bundled tool",
      source: "bundled",
      format: "toml",
      enabled: true,
      compatibility: "native",
      eligibility: "selectable",
    };

    render(
      <SkillCard
        skill={skill}
        onInspect={vi.fn()}
        onToggleEnable={vi.fn()}
        onReplace={vi.fn()}
        onUninstall={vi.fn()}
      />
    );

    expect(screen.getByText("Bundled")).toBeTruthy();
    expect(screen.getByText(/toml/i)).toBeTruthy();
    expect(screen.getByText("Selectable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Inspect" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Replace" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Uninstall" })).toBeNull();
  });

  it("disables toggle when compatibility is needs_adaptation", () => {
    const skill: Skill = {
      id: "raw-package",
      name: "raw-package",
      description: "Unadapted foreign package",
      source: "imported",
      format: "markdown",
      enabled: false,
      compatibility: "needs_adaptation",
      eligibility: "needs_adaptation",
    };

    render(
      <SkillCard
        skill={skill}
        onToggleEnable={vi.fn()}
      />
    );

    expect(screen.getByText("Needs adaptation")).toBeTruthy();
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it("calls onToggleEnable when checkbox is clicked", async () => {
    const user = userEvent.setup();
    const onToggleEnable = vi.fn();
    const skill: Skill = {
      id: "test-skill",
      name: "test-skill",
      description: "Test",
      source: "imported",
      enabled: false,
      compatibility: "native",
      eligibility: "disabled",
    };

    render(
      <SkillCard
        skill={skill}
        onToggleEnable={onToggleEnable}
      />
    );

    const checkbox = screen.getByRole("checkbox");
    await user.click(checkbox);

    expect(onToggleEnable).toHaveBeenCalledWith(skill, true);
  });
});
