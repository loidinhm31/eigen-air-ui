import * as React from "react";
import { useEffect, useState } from "react";
import { getMemoryService } from "../../adapters/factory/ServiceFactory.js";
import { MemoryItem } from "../molecules/MemoryItem.js";
import { Input } from "../atoms/Input.js";
import { Button } from "../atoms/Button.js";
import type { MemoryEntry } from "@eigen-air-ui/shared/types";
import { useMemoryStore } from "../../stores/memoryStore.js";

function parseValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function editValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function MemoryBrowser() {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useMemoryStore((state) => state.revision);
  const loadGeneration = React.useRef(0);
  const loadAbort = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async () => {
    const curGen = ++loadGeneration.current;
    if (loadAbort.current) {
      loadAbort.current.abort();
    }
    const controller = new AbortController();
    loadAbort.current = controller;
    setLoading(true);
    setError(null);
    try {
      const items = await getMemoryService().list({ signal: controller.signal });
      if (curGen !== loadGeneration.current || controller.signal.aborted) return;
      setEntries(items);
    } catch (cause) {
      if (curGen !== loadGeneration.current || controller.signal.aborted) return;
      setError(String(cause));
    } finally {
      if (curGen === loadGeneration.current && !controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  async function save() {
    if (!key.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await getMemoryService().store(key.trim(), parseValue(value));
      setKey("");
      setValue("");
      await load();
    } catch (cause) {
      setError(String(cause));
      setLoading(false);
    }
  }

  async function remove(entryKey: string) {
    await getMemoryService().forget(entryKey);
    await load();
  }

  function edit(entry: MemoryEntry) {
    setKey(entry.key);
    setValue(editValue(entry.value));
  }

  useEffect(() => {
    void load();
    return () => {
      if (loadAbort.current) {
        loadAbort.current.abort();
      }
    };
  }, [load, revision]);

  const displayed = entries.filter((entry) =>
    `${entry.key} ${editValue(entry.value)}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <section className="flex min-h-0 flex-col gap-3 rounded-md border border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Working memory</h2>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>
      <div className="grid gap-2 md:grid-cols-[1fr_2fr_auto]">
        <Input aria-label="Memory key" value={key} onChange={(event) => setKey(event.target.value)} placeholder="Key" />
        <Input aria-label="Memory value" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Value or JSON" />
        <Button onClick={() => void save()} disabled={loading || !key.trim()}>Save memory</Button>
      </div>
      <Input aria-label="Search working memory" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search working memory" />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="max-h-64 space-y-2 overflow-auto">
        {displayed.map((entry) => (
          <MemoryItem key={entry.key} entry={entry} onEdit={edit} onDelete={(entryKey) => void remove(entryKey)} />
        ))}
        {!loading && displayed.length === 0 && <p className="text-sm text-muted-foreground">No working memories</p>}
      </div>
    </section>
  );
}
MemoryBrowser.displayName = "MemoryBrowser";
