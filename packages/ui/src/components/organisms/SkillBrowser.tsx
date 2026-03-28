import * as React from "react";
import { useEffect, useState } from "react";
import { getSkillService } from "../../adapters/factory/ServiceFactory.js";
import { SkillCard } from "../molecules/SkillCard.js";
import { Input } from "../atoms/Input.js";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";
import { ScrollArea } from "../atoms/ScrollArea.js";
import type { Skill, SkillSearchResult } from "@nonclaw-ui/shared/types";

export function SkillBrowser() {
  const [query, setQuery] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [searchResults, setSearchResults] = useState<SkillSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    getSkillService()
      .list()
      .then(setSkills)
      .finally(() => setLoading(false));
  }, []);

  async function handleSearch() {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setLoading(true);
    try {
      const results = await getSkillService().search(query.trim());
      setSearchResults(results);
    } finally {
      setLoading(false);
    }
  }

  const displaySkills = query.trim() ? searchResults : skills;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void handleSearch()}
          placeholder="Search skills (BM25)..."
          className="flex-1"
        />
        <Button onClick={() => void handleSearch()} disabled={loading}>
          Search
        </Button>
      </div>

      {loading && (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2">
          {displaySkills.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground text-center py-8">
              {query.trim() ? "No results" : "No skills loaded"}
            </p>
          )}
          {query.trim()
            ? searchResults.map((r) => <SkillCard key={r.name} skill={r} score={r.score} />)
            : skills.map((s) => <SkillCard key={s.name} skill={s} />)}
        </div>
      </ScrollArea>

      <p className="text-xs text-muted-foreground">
        {skills.length} skill{skills.length !== 1 ? "s" : ""} loaded
        {searchResults.length > 0 && ` · ${searchResults.length} results`}
      </p>
    </div>
  );
}
SkillBrowser.displayName = "SkillBrowser";
