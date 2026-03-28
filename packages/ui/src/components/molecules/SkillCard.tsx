import * as React from "react";
import { Badge } from "../atoms/Badge.js";
import type { Skill, SkillSearchResult } from "@nonclaw-ui/shared/types";

type Props =
  | { skill: Skill; score?: never }
  | { skill: SkillSearchResult; score: number };

export function SkillCard({ skill, score }: Props) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-sm space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium font-mono">{skill.name}</span>
        {score !== undefined && (
          <Badge variant="primary" className="text-xs shrink-0">
            {score.toFixed(2)}
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{skill.description}</p>
      {"tags" in skill && skill.tags && skill.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {skill.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
SkillCard.displayName = "SkillCard";
