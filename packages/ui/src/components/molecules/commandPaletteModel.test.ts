import { describe, expect, it } from "vitest";
import {
  BUILT_IN_COMMANDS,
  commandPaletteOptionId,
  commandPaletteOutcome,
  createCommandPaletteOptions,
  filterCommandPaletteOptions,
} from "./commandPaletteModel.js";

describe("command palette model", () => {
  it("offers exactly the five parser-supported memory commands", () => {
    expect(BUILT_IN_COMMANDS.map((command) => command.command)).toEqual([
      "!remember ",
      "!recall ",
      "!forget ",
      "!list",
      "!count",
    ]);
  });

  it("filters commands and skills locally with case-insensitive substring matching", () => {
    const options = createCommandPaletteOptions([
      { id: "code_review", name: "Code review", description: "Review a pull request" },
    ]);

    expect(filterCommandPaletteOptions(options, "RECALL")).toMatchObject([
      { kind: "command", command: "!recall " },
    ]);
    expect(filterCommandPaletteOptions(options, "pull request")).toMatchObject([
      { kind: "skill", id: "code_review" },
    ]);
  });

  it("keeps command insertion and skill ID selection as distinct outcomes", () => {
    const options = createCommandPaletteOptions([
      { id: "trusted_id", name: "Untrusted name", description: "Untrusted description" },
    ]);
    const command = options[0];
    const skill = options.find((option) => option.kind === "skill");
    if (!skill) throw new Error("expected test skill");

    expect(commandPaletteOutcome(command)).toEqual({ kind: "command", command: "!remember " });
    expect(commandPaletteOutcome(skill)).toEqual({
      kind: "skill",
      skill: { id: "trusted_id", name: "Untrusted name", description: "Untrusted description" },
    });
    expect(commandPaletteOptionId(skill)).toBe("command-palette-option-skill-trusted_id");
  });
});
