import type { RunMemoryLineageDto } from "@nonclaw-ui/shared/types";

export function MemoryLineagePanel({ lineage }: { lineage: RunMemoryLineageDto[] }) {
  return (
    <section aria-labelledby="run-lineage-heading">
      <h3 id="run-lineage-heading" className="text-sm font-semibold">
        Server-proven memory lineage
      </h3>
      {lineage.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">
          No memory relation was reported by the server.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {lineage.slice(0, 200).map((item) => (
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
    </section>
  );
}
