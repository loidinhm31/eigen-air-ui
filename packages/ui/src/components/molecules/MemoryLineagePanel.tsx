import type { RunMemoryLineageDto } from "@eigen-air-ui/shared/types";
import { useBasePathNavigation } from "../../embed/base-path-navigation.js";

export interface MemoryLineagePanelProps {
  lineage: RunMemoryLineageDto[];
  hasMore?: boolean;
  isLoading?: boolean;
  error?: string;
  onLoadMore?: () => void;
  onNavigate?: (path: string) => void;
}

function useSafeBasePathNavigation() {
  try {
    return useBasePathNavigation();
  } catch {
    return { to: (p: string) => p, navigate: () => undefined };
  }
}

export function formatMemoryTier(kind: RunMemoryLineageDto["memory_kind"]): string {
  switch (kind) {
    case "working":
      return "working memory tier";
    case "episode":
      return "episodic memory tier";
    case "fact":
      return "knowledge fact tier";
    default:
      return `${kind} tier`;
  }
}

export function formatLineageRelation(relation: RunMemoryLineageDto["relation"]): string {
  switch (relation) {
    case "used":
      return "used (included in request)";
    case "considered":
      return "considered";
    case "written":
      return "written";
    default:
      return relation;
  }
}

export interface LineageNavigationTarget {
  path: string;
  label: string;
}

export function resolveLineageNavigationTarget(
  item: RunMemoryLineageDto
): LineageNavigationTarget | null {
  if (item.memory_kind === "episode") {
    if (!item.memory_reference) return null;
    return {
      path: `/memory?episode_id=${encodeURIComponent(item.memory_reference)}`,
      label: "View episode source",
    };
  }
  if (item.memory_kind === "fact") {
    if (!item.source_episode_id) return null;
    return {
      path: `/memory?episode_id=${encodeURIComponent(item.source_episode_id)}`,
      label: "View source episode",
    };
  }
  if (item.memory_kind === "working") {
    return {
      path: "/memory",
      label: "View working memory",
    };
  }
  return null;
}

export function MemoryLineagePanel({
  lineage,
  hasMore = false,
  isLoading = false,
  error,
  onLoadMore,
  onNavigate,
}: MemoryLineagePanelProps) {
  const nav = useSafeBasePathNavigation();
  const handleNavigate = onNavigate ?? nav.navigate;

  return (
    <section aria-labelledby="run-lineage-heading">
      <div className="flex items-center justify-between gap-2">
        <h3 id="run-lineage-heading" className="text-sm font-semibold">
          Server-proven memory lineage
        </h3>
        {lineage.length > 0 && (
          <span className="text-muted-foreground text-xs">
            {lineage.length} loaded
          </span>
        )}
      </div>
      {lineage.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">
          No memory relation was reported by the server.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {lineage.map((item) => {
            const target = resolveLineageNavigationTarget(item);
            return (
              <li key={item.lineage_seq} className="border-border rounded-md border p-2 text-xs">
                <div className="flex flex-wrap items-baseline justify-between gap-1">
                  <p>
                    <span className="font-medium">{formatLineageRelation(item.relation)}</span> ·{" "}
                    <span className="text-muted-foreground">{formatMemoryTier(item.memory_kind)}</span> ·{" "}
                    <span className="font-mono">{item.memory_reference}</span>
                  </p>
                  {target && (
                    <button
                      type="button"
                      onClick={() => handleNavigate(target.path)}
                      className="text-xs font-medium text-primary hover:underline cursor-pointer"
                      aria-label={`${target.label} for ${item.memory_reference}`}
                    >
                      {target.label} →
                    </button>
                  )}
                </div>
                <p className="text-muted-foreground mt-1">
                  scope: tenant/{item.tenant_id} · user/{item.user_id} · agent/{item.agent_id}
                  {` · workspace/${item.workspace_id}`}
                  {item.source_episode_id ? ` · source episode/${item.source_episode_id}` : ""}
                  {item.provenance ? ` · ${item.provenance}` : ""}
                  {item.confidence !== null && item.confidence !== undefined
                    ? ` · heuristic confidence ${item.confidence}`
                    : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore && (
        <div className="mt-2">
          <button
            type="button"
            disabled={isLoading}
            onClick={onLoadMore}
            className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
            aria-label="Load more memory lineage"
          >
            {isLoading ? "Loading more relations…" : "Load more relations"}
          </button>
          {error && (
            <p role="alert" className="mt-1 text-destructive text-xs">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
