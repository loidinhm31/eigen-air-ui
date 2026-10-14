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
      { id: "code_review", name: "Code review", description: "Review a pull request", enabled: true, eligibility: "selectable" },
    ]);

    expect(filterCommandPaletteOptions(options, "RECALL")).toMatchObject([
      { kind: "command", command: "!recall " },
    ]);
    expect(filterCommandPaletteOptions(options, "pull request")).toMatchObject([
      { kind: "skill", id: "code_review" },
    ]);
  });

  it("keeps command insertion and skill ID selection as distinct outcomes", () => {
    const testSkill = {
      id: "trusted_id",
      name: "Untrusted name",
      description: "Untrusted description",
      enabled: true,
      eligibility: "selectable" as const,
    };
    const options = createCommandPaletteOptions([testSkill]);
    const command = options[0];
    const skill = options.find((option) => option.kind === "skill");
    if (!skill) throw new Error("expected test skill");
    expect(commandPaletteOutcome(command)).toEqual({ kind: "command", command: "!remember " });
    expect(commandPaletteOutcome(skill)).toEqual({
      kind: "skill",
      skill: testSkill,
    });
    expect(commandPaletteOptionId(skill)).toBe("command-palette-option-skill-trusted_id");
  });

  it("filters out disabled, uninspected, incompatible, or missing-tool skills", () => {
    const options = createCommandPaletteOptions([
      { id: "active_skill", name: "Active", description: "Selectable", enabled: true, eligibility: "selectable" },
      { id: "disabled_skill", name: "Disabled", description: "Disabled", enabled: false, eligibility: "disabled" },
      { id: "needs_insp", name: "Inspect Me", description: "Changed", enabled: true, eligibility: "inspection_required" },
      { id: "needs_adapt", name: "Foreign", description: "Incompatible", enabled: false, compatibility: "needs_adaptation" },
      { id: "missing_tool", name: "No Tools", description: "Missing tool", enabled: true, eligibility: "missing_tools" },
    ]);

    const skillOptions = options.filter((o) => o.kind === "skill");
    expect(skillOptions).toHaveLength(1);
    expect(skillOptions[0]).toMatchObject({ id: "active_skill" });
  });

  it("fails closed and excludes skills with absent enabled, eligibility, or compatibility", () => {
    const options = createCommandPaletteOptions([
      { id: "missing_enabled", name: "No Enabled", description: "Desc", eligibility: "selectable", compatibility: "native" },
      { id: "missing_eligibility", name: "No Eligibility", description: "Desc", enabled: true, compatibility: "native" },
      { id: "missing_both", name: "No Flags", description: "Desc" },
      { id: "valid_skill", name: "Valid", description: "Desc", enabled: true, eligibility: "selectable", compatibility: "native" },
    ]);
    const skillOptions = options.filter((o) => o.kind === "skill");
    expect(skillOptions).toHaveLength(1);
    expect(skillOptions[0]).toMatchObject({ id: "valid_skill" });
  });
});
