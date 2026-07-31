import type { Skill } from "@nonclaw-ui/shared/types";

export const BUILT_IN_COMMANDS = [
  {
    id: "remember",
    label: "Remember",
    command: "!remember ",
    description: "Save a memory. Add a key and value after the command.",
  },
  {
    id: "recall",
    label: "Recall",
    command: "!recall ",
    description: "Search saved memories.",
  },
  {
    id: "forget",
    label: "Forget",
    command: "!forget ",
    description: "Remove a saved memory by key.",
  },
  {
    id: "list",
    label: "List memories",
    command: "!list",
    description: "List saved memory keys.",
  },
  {
    id: "count",
    label: "Count memories",
    command: "!count",
    description: "Show the number of saved memories.",
  },
] as const;

export type CommandPaletteCommand = (typeof BUILT_IN_COMMANDS)[number];

export type CommandPaletteOption =
  | {
      kind: "command";
      id: string;
      label: string;
      description: string;
      command: string;
    }
  | {
      kind: "skill";
      id: string;
      name: string;
      description: string;
      skill: Skill;
    };

export type PaletteSelection =
  | { kind: "command"; command: string }
  | { kind: "skill"; skill: Skill };

/** @deprecated Prefer PaletteSelection. */
export type CommandPaletteOutcome = PaletteSelection;

export function commandPaletteOptionId(
  option: CommandPaletteOption,
  paletteId = "command-palette"
): string {
  return `${paletteId}-option-${option.kind}-${encodeURIComponent(option.id)}`;
}

export function commandPaletteOutcome(option: CommandPaletteOption): PaletteSelection {
  return option.kind === "command"
    ? { kind: "command", command: option.command }
    : { kind: "skill", skill: option.skill };
}

export function createCommandPaletteOptions(skills: readonly Skill[] = []): CommandPaletteOption[] {
  return [
    ...BUILT_IN_COMMANDS.map((command) => ({ kind: "command" as const, ...command })),
    ...skills.map((skill) => ({
      kind: "skill" as const,
      id: skill.id,
      name: skill.name,
      description: skill.description,
      skill,
    })),
  ];
}

/** Case-insensitive local substring matching; no remote/fuzzy lookup is involved. */
export function filterCommandPaletteOptions(
  options: readonly CommandPaletteOption[],
  query: string
): CommandPaletteOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...options];

  return options.filter((option) => {
    const searchable =
      option.kind === "command"
        ? `${option.label} ${option.command} ${option.description}`
        : `${option.id} ${option.name} ${option.description}`;
    return searchable.toLocaleLowerCase().includes(normalizedQuery);
  });
}
