import * as React from "react";
import { Badge } from "../atoms/Badge.js";
import { Button } from "../atoms/Button.js";
import type { Skill, SkillSearchResult } from "@eigen-air-ui/shared/types";

export interface SkillCardProps {
  skill: Skill | SkillSearchResult;
  score?: number;
  onInspect?: (skill: Skill) => void;
  onToggleEnable?: (skill: Skill, nextEnabled: boolean) => void;
  onReplace?: (skill: Skill) => void;
  onUninstall?: (skill: Skill) => void;
  mutating?: boolean;
}

export function SkillCard({
  skill,
  score,
  onInspect,
  onToggleEnable,
  onReplace,
  onUninstall,
  mutating = false,
}: SkillCardProps) {
  const isImported = skill.source === "imported";
  const isEnabled = skill.enabled === true;
  const isNeedsAdaptation = skill.compatibility === "needs_adaptation";
  const isInspectionRequired = skill.eligibility === "inspection_required";
  const isMissingTools = skill.eligibility === "missing_tools";

  return (
    <div className="rounded-md border border-border bg-card p-3 text-sm space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold font-mono text-base">{skill.name}</span>
          {skill.version && (
            <span className="text-xs text-muted-foreground font-mono">v{skill.version}</span>
          )}
          <Badge variant="outline" className="text-xs">
            {isImported ? "Imported" : "Bundled"}
          </Badge>
          {skill.format && (
            <Badge variant="outline" className="text-xs font-mono uppercase">
              {skill.format}
            </Badge>
          )}
          {isNeedsAdaptation ? (
            <Badge variant="destructive" className="text-xs">
              Needs adaptation
            </Badge>
          ) : skill.compatibility === "native" ? (
            <Badge variant="success" className="text-xs">
              Native
            </Badge>
          ) : null}
          {isInspectionRequired ? (
            <Badge variant="warning" className="text-xs">
              Needs inspection
            </Badge>
          ) : isMissingTools ? (
            <Badge variant="destructive" className="text-xs">
              Missing tools
            </Badge>
          ) : skill.eligibility === "selectable" ? (
            <Badge variant="success" className="text-xs">
              Selectable
            </Badge>
          ) : skill.eligibility === "disabled" ? (
            <Badge variant="default" className="text-xs text-muted-foreground">
              Disabled
            </Badge>
          ) : null}
        </div>

        {score !== undefined && (
          <Badge variant="primary" className="text-xs shrink-0 font-mono">
            Score: {score.toFixed(2)}
          </Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>

      {/* Tools & Diagnostics */}
      {skill.required_tools && skill.required_tools.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Required tools:</span>
          <span className="font-mono">{skill.required_tools.join(", ")}</span>
        </div>
      )}

      {/* Tags */}
      {skill.tags && skill.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {skill.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Action controls row */}
      {(onInspect || onToggleEnable || onReplace || onUninstall) && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/50">
          <div className="flex items-center gap-2">
            {onToggleEnable && (
              <label
                className="flex items-center gap-2 text-xs cursor-pointer select-none"
                title={
                  isNeedsAdaptation
                    ? "Incompatible foreign package cannot be enabled"
                    : isInspectionRequired
                    ? "Inspect the updated revision to re-consent"
                    : isEnabled
                    ? "Disable skill for this runtime"
                    : "Inspect skill to enable for this runtime"
                }
              >
                <input
                  type="checkbox"
                  checked={isEnabled}
                  disabled={mutating || isNeedsAdaptation}
                  onChange={(e) => onToggleEnable(skill as Skill, e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                  aria-label={`Enable ${skill.name} for current runtime`}
                />
                <span className="text-muted-foreground">
                  {isEnabled
                    ? isInspectionRequired
                      ? "Enabled (needs inspection)"
                      : "Enabled (this runtime)"
                    : "Disabled (this runtime)"}
                </span>
              </label>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {onInspect && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onInspect(skill as Skill)}
                disabled={mutating}
              >
                Inspect
              </Button>
            )}

            {isImported && onReplace && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onReplace(skill as Skill)}
                disabled={mutating}
              >
                Replace
              </Button>
            )}

            {isImported && onUninstall && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => onUninstall(skill as Skill)}
                disabled={mutating}
              >
                Uninstall
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
SkillCard.displayName = "SkillCard";
