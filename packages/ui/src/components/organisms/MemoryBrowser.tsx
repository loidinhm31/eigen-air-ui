import * as React from "react";
import { useEffect, useState } from "react";
import { useMemoryStore } from "../../stores/memoryStore.js";
import { getMemoryService } from "../../adapters/factory/ServiceFactory.js";
import { MemoryItem } from "../molecules/MemoryItem.js";
import { Input } from "../atoms/Input.js";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";
import { ScrollArea } from "../atoms/ScrollArea.js";
import type { MemoryEntry } from "@nonclaw-ui/shared/types";

export function MemoryBrowser() {
  const { keys, searchResults, setKeys, setSearchResults } = useMemoryStore();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadKeys() {
    setLoading(true);
    setError(null);
    try {
      const k = await getMemoryService().list();
      setKeys(k);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch() {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const results = await getMemoryService().search(query.trim());
      setSearchResults(results);
      setEntries(results.map((r) => ({ key: r.key, value: r.value })));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(key: string) {
    const prevKeys = keys;
    const prevEntries = entries;
    setKeys(keys.filter((k) => k !== key));
    setEntries((prev) => prev.filter((e) => e.key !== key));
    try {
      await getMemoryService().forget(key);
    } catch (e) {
      setKeys(prevKeys);
      setEntries(prevEntries);
      setError(String(e));
    }
  }

  useEffect(() => {
    void loadKeys();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      setEntries([]);
    }
  }, [query]);

  const displayEntries = query.trim() ? entries : keys.map((k) => ({ key: k, value: "" }));

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
          placeholder="Search memories..."
          className="flex-1"
        />
        <Button onClick={() => void handleSearch()} disabled={loading}>
          Search
        </Button>
        <Button variant="outline" onClick={() => void loadKeys()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {loading && (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1.5">
          {displayEntries.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground text-center py-8">No memories found</p>
          )}
          {displayEntries.map((entry) => (
            <MemoryItem key={entry.key} entry={entry} onDelete={handleDelete} />
          ))}
        </div>
      </ScrollArea>

      <p className="text-xs text-muted-foreground">
        {keys.length} {keys.length === 1 ? "entry" : "entries"}
        {searchResults.length > 0 && ` · ${searchResults.length} search results`}
      </p>
    </div>
  );
}
MemoryBrowser.displayName = "MemoryBrowser";
