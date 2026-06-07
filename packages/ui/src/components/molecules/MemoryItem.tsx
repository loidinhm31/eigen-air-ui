import * as React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "../atoms/Button.js";
import type { MemoryEntry } from "@nonclaw-ui/shared/types";

interface Props {
  entry: MemoryEntry;
  onDelete: (key: string) => void;
  onEdit: (entry: MemoryEntry) => void;
}

function renderValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function MemoryItem({ entry, onDelete, onEdit }: Props) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm">
      <div className="flex-1 min-w-0">
        <p className="font-mono text-xs text-muted-foreground truncate">{entry.key}</p>
        <p className="mt-0.5 text-foreground break-words">{renderValue(entry.value)}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground"
        onClick={() => onEdit(entry)}
        aria-label={`Edit memory key ${entry.key}`}
      >
        <Pencil size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={() => onDelete(entry.key)}
        aria-label={`Delete memory key ${entry.key}`}
      >
        <Trash2 size={14} />
      </Button>
    </div>
  );
}
MemoryItem.displayName = "MemoryItem";
