import type { RunMemoryLineageDto } from "@eigen-air-ui/shared/types";

export interface MemoryLineagePanelProps {
  lineage: RunMemoryLineageDto[];
  hasMore?: boolean;
  isLoading?: boolean;
  error?: string;
  onLoadMore?: () => void;
}

export function MemoryLineagePanel({
  lineage,
  hasMore = false,
  isLoading = false,
  error,
  onLoadMore,
}: MemoryLineagePanelProps) {
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
          {lineage.map((item) => (
            <li key={item.lineage_seq} className="border-border rounded-md border p-2 text-xs">
              <p>
                <span className="font-medium">{item.relation}</span> · {item.memory_kind} ·{" "}
                {item.memory_reference}
              </p>
              <p className="text-muted-foreground mt-1">
                scope: tenant/{item.tenant_id} · user/{item.user_id} · agent/{item.agent_id}
                {` · workspace/${item.workspace_id}`}
                {item.source_episode_id ? ` · source episode/${item.source_episode_id}` : ""}
                {item.provenance ? ` · ${item.provenance}` : ""}
                {item.confidence !== null && item.confidence !== undefined
                  ? ` · confidence ${item.confidence}`
                  : ""}
              </p>
            </li>
          ))}
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
