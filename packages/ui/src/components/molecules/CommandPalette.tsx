import * as React from "react";
import { Command, X } from "lucide-react";
import type { Skill } from "@nonclaw-ui/shared/types";
import { Button } from "../atoms/Button.js";
import { Input } from "../atoms/Input.js";
import {
  commandPaletteOptionId,
  commandPaletteOutcome,
  createCommandPaletteOptions,
  filterCommandPaletteOptions,
  type CommandPaletteOption,
  type PaletteSelection,
} from "./commandPaletteModel.js";

export interface CommandPaletteProps {
  /** Controlled disclosure state. Omit only for a self-contained palette. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Controlled discovery query. Omit only for a self-contained palette. */
  query?: string;
  onQueryChange?: (query: string) => void;
  skills?: readonly Skill[];
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  onSelect: (selection: PaletteSelection) => void;
  /** Returns focus to the message composer after an explicit choice. */
  onRequestComposerFocus?: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

function optionLabel(option: CommandPaletteOption): string {
  return option.kind === "command" ? option.command : option.name;
}

export function CommandPalette({
  open: controlledOpen,
  onOpenChange,
  query: controlledQuery,
  onQueryChange,
  skills = [],
  loading = false,
  error = null,
  disabled = false,
  onSelect,
  onRequestComposerFocus,
  inputRef: externalInputRef,
}: CommandPaletteProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const [uncontrolledQuery, setUncontrolledQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
  const paletteId = React.useId();
  const inputId = `${paletteId}-input`;
  const listboxId = `${paletteId}-listbox`;
  const paletteInputRef = React.useRef<HTMLInputElement>(null);
  const optionRefs = React.useRef(new Map<string, HTMLDivElement>());
  const isOpen = controlledOpen ?? uncontrolledOpen;
  const query = controlledQuery ?? uncontrolledQuery;
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange]
  );
  const setQuery = React.useCallback(
    (next: string) => {
      if (controlledQuery === undefined) setUncontrolledQuery(next);
      onQueryChange?.(next);
    },
    [controlledQuery, onQueryChange]
  );

  const setInputRefs = React.useCallback(
    (node: HTMLInputElement | null) => {
      paletteInputRef.current = node;
      if (typeof externalInputRef === "function") externalInputRef(node);
      else if (externalInputRef) externalInputRef.current = node;
    },
    [externalInputRef]
  );

  const allOptions = React.useMemo(() => createCommandPaletteOptions(skills), [skills]);
  const options = React.useMemo(
    () => filterCommandPaletteOptions(allOptions, query),
    [allOptions, query]
  );
  const activeOption = activeIndex === null ? undefined : options[activeIndex];

  React.useEffect(() => {
    if (!isOpen) return;
    setActiveIndex(options.length > 0 ? 0 : null);
  }, [isOpen, query, options.length]);

  React.useEffect(() => {
    if (!isOpen) return;
    paletteInputRef.current?.focus();
  }, [isOpen]);

  React.useEffect(() => {
    if (!activeOption) return;
    const element = optionRefs.current.get(commandPaletteOptionId(activeOption, paletteId));
    element?.scrollIntoView?.({ block: "nearest" });
  }, [activeOption, paletteId]);

  const selectOption = React.useCallback(
    (option: CommandPaletteOption) => {
      onSelect(commandPaletteOutcome(option));
      setQuery("");
      setOpen(false);
      setActiveIndex(null);
      onRequestComposerFocus?.();
    },
    [onRequestComposerFocus, onSelect, setOpen, setQuery]
  );

  function openPalette() {
    if (!disabled) setOpen(true);
  }

  function closePalette() {
    setOpen(false);
    setActiveIndex(null);
  }

  function moveActive(direction: 1 | -1) {
    if (!options.length) return;
    setActiveIndex((current) => {
      if (current === null) return direction === 1 ? 0 : options.length - 1;
      return (current + direction + options.length) % options.length;
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) openPalette();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) openPalette();
      moveActive(-1);
    } else if (event.key === "Enter" && isOpen && activeOption) {
      event.preventDefault();
      selectOption(activeOption);
    } else if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      closePalette();
    }
    // Tab and ordinary editing keys intentionally retain their native input behavior.
  }

  const noMatches = isOpen && query.trim().length > 0 && options.length === 0;
  const commandOptions = options.filter((option) => option.kind === "command");
  const skillOptions = options.filter((option) => option.kind === "skill");

  function renderOption(option: CommandPaletteOption) {
    const isActive = option === activeOption;
    const optionId = commandPaletteOptionId(option, paletteId);
    return (
      <div
        key={`${option.kind}:${option.id}`}
        ref={(node) => {
          if (node) optionRefs.current.set(optionId, node);
          else optionRefs.current.delete(optionId);
        }}
        id={optionId}
        role="option"
        aria-selected={isActive}
        tabIndex={-1}
        className={`cursor-pointer rounded-sm px-2 py-2 text-sm outline-none ${
          isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
        }`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => selectOption(option)}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium">{optionLabel(option)}</span>
          <span className="text-muted-foreground text-xs">
            {option.kind === "command" ? "Command" : "Skill suggestion"}
          </span>
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs">{option.description}</p>
        {option.kind === "skill" && (
          <p className="text-muted-foreground mt-0.5 font-mono text-xs">ID: {option.id}</p>
        )}
      </div>
    );
  }

  return (
    <div className="relative min-w-0">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Open commands and skills"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => (isOpen ? closePalette() : openPalette())}
      >
        <Command className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
        Commands
      </Button>

      {isOpen && (
        <div className="border-border bg-card text-card-foreground absolute bottom-full left-0 z-20 mb-2 w-[min(24rem,calc(100vw-2rem))] rounded-md border p-2 shadow-lg">
          <label htmlFor={inputId} className="sr-only">
            Search commands and installed skills
          </label>
          <div className="relative">
            <Input
              ref={setInputRefs}
              id={inputId}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={isOpen}
              aria-controls={listboxId}
              aria-activedescendant={
                activeOption ? commandPaletteOptionId(activeOption, paletteId) : undefined
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search commands and skills"
              autoComplete="off"
            />
            <button
              type="button"
              className="text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2"
              aria-label="Close commands and skills"
              tabIndex={-1}
              onClick={closePalette}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div
            id={listboxId}
            role="listbox"
            aria-label="Commands and installed skills"
            className="mt-2 max-h-64 overflow-y-auto rounded-sm"
          >
            {commandOptions.length > 0 && (
              <div role="group" aria-label="Commands">
                <p
                  aria-hidden="true"
                  className="text-muted-foreground px-2 py-1 text-xs font-medium"
                >
                  Commands
                </p>
                {commandOptions.map(renderOption)}
              </div>
            )}
            {skillOptions.length > 0 && (
              <div role="group" aria-label="Installed skills">
                <p
                  aria-hidden="true"
                  className="text-muted-foreground px-2 pb-1 pt-2 text-xs font-medium"
                >
                  Installed skills
                </p>
                {skillOptions.map(renderOption)}
              </div>
            )}
            {noMatches && (
              <p role="status" className="text-muted-foreground px-2 py-3 text-sm">
                No matching commands or skills.
              </p>
            )}
          </div>

          <div aria-live="polite" className="text-muted-foreground mt-2 text-xs">
            {loading && "Loading installed skills…"}
            {!loading &&
              !error &&
              skills.length === 0 &&
              "No installed skills. Built-in commands remain available."}
            {error && `${error}. Built-in commands remain available.`}
          </div>
        </div>
      )}
    </div>
  );
}

CommandPalette.displayName = "CommandPalette";
