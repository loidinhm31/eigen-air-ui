// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette.js";

describe("CommandPalette", () => {
  afterEach(cleanup);

  it("uses the APG combobox/listbox keyboard model and returns focus after selection", async () => {
    const onSelect = vi.fn();
    const onRequestComposerFocus = vi.fn();
    const user = userEvent.setup();
    render(
      <CommandPalette
        skills={[{ id: "code_review", name: "Code review", description: "Review code" }]}
        onSelect={onSelect}
        onRequestComposerFocus={onRequestComposerFocus}
      />
    );

    await user.click(screen.getByRole("button", { name: "Open commands and skills" }));
    const input = screen.getByRole("combobox", { name: "Search commands and installed skills" });
    const listbox = screen.getByRole("listbox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(document.activeElement).toBe(input);
    expect(screen.getAllByRole("option").every((option) => option.tabIndex === -1)).toBe(true);
    expect(screen.getByRole("group", { name: "Commands" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Installed skills" })).toBeTruthy();

    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith({ kind: "command", command: "!recall " });
    expect(onRequestComposerFocus).toHaveBeenCalledOnce();
  });

  it("filters locally, announces zero results, and keeps commands after a skill error", async () => {
    const user = userEvent.setup();
    render(<CommandPalette skills={[]} error="Service denied" onSelect={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Open commands and skills" }));
    expect(screen.getByText(/Built-in commands remain available/)).toBeTruthy();
    expect(screen.getByRole("option", { name: /!list/i })).toBeTruthy();

    await user.type(screen.getByRole("combobox"), "nothing-here");
    expect(screen.getByRole("status").textContent).toBe("No matching commands or skills.");
  });

  it("keeps Escape and Tab non-selecting, but selects a stable skill ID on click", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <CommandPalette
          skills={[{ id: "ship-it", name: "Ship it", description: "Untrusted <b>metadata</b>" }]}
          onSelect={onSelect}
        />
        <button type="button">Next field</button>
      </>
    );
    await user.click(screen.getByRole("button", { name: "Open commands and skills" }));
    const input = screen.getByRole("combobox");
    await user.type(input, "ship");
    await user.keyboard("{Escape}");
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Open commands and skills" }));
    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next field" }));

    await user.click(screen.getByRole("button", { name: "Open commands and skills" }));
    await user.click(screen.getByRole("button", { name: "Open commands and skills" }));
    expect(screen.getByText("Untrusted <b>metadata</b>")).toBeTruthy();
    expect(screen.queryByText("metadata", { selector: "b" })).toBeNull();
    await user.click(screen.getByRole("option", { name: /Ship it/ }));
    expect(onSelect).toHaveBeenLastCalledWith({
      kind: "skill",
      skill: { id: "ship-it", name: "Ship it", description: "Untrusted <b>metadata</b>" },
    });
  });

  it("uses unique combobox and listbox IDs for multiple palette instances", async () => {
    const user = userEvent.setup();
    render(
      <>
        <CommandPalette onSelect={vi.fn()} />
        <CommandPalette onSelect={vi.fn()} />
      </>
    );

    const triggers = screen.getAllByRole("button", { name: "Open commands and skills" });
    await user.click(triggers[0]!);
    await user.click(triggers[1]!);

    const comboboxes = screen.getAllByRole("combobox");
    const listboxes = screen.getAllByRole("listbox");
    expect(comboboxes[0]?.id).not.toBe(comboboxes[1]?.id);
    expect(listboxes[0]?.id).not.toBe(listboxes[1]?.id);
    expect(comboboxes[0]?.getAttribute("aria-controls")).toBe(listboxes[0]?.id);
    expect(comboboxes[1]?.getAttribute("aria-controls")).toBe(listboxes[1]?.id);
  });
});
