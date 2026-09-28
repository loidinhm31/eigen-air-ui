import type { ToolSelectionDto } from "@eigen-air-ui/shared/types";
import { formatToolReason } from "./toolSelectionReasons.js";

export interface ToolSelectionDiagnosticProps {
  toolSelection?: ToolSelectionDto | null;
  occurredAtMs?: number;
}

export function ToolSelectionDiagnostic({
  toolSelection,
  occurredAtMs,
}: ToolSelectionDiagnosticProps) {
  if (!toolSelection) {
    return (
      <div
        aria-label="Tool selection diagnostics"
        className="border-border bg-muted/30 rounded border p-3 text-xs"
      >
        <p className="text-muted-foreground">Tool selection diagnostics not reported.</p>
      </div>
    );
  }

  if (toolSelection.schema_version !== "tool_selection.v1") {
    return (
      <div
        aria-label="Tool selection diagnostics"
        className="border-border bg-muted/30 rounded border p-3 text-xs"
      >
        <p className="text-destructive font-medium">
          Tool selection diagnostic unavailable (unsupported schema version:{" "}
          {toolSelection.schema_version || "missing"})
        </p>
      </div>
    );
  }

  const {
    effective_cap,
    cap_source,
    checked_count,
    eligible_count,
    selected_count,
    rejected_count,
    required_count = 0,
    context_count = 0,
    optional_count = 0,
    global_count = 0,
    selected_total,
    selected_omitted = 0,
    rejected_total,
    rejected_omitted = 0,
    reason_counts = {},
    order_hash,
    selected_tools,
    rejected_tools,
    name_details_redacted,
  } = toolSelection;

  const isZeroCapWithRequired = effective_cap === 0 && required_count > 0;

  return (
    <div
      aria-label="Tool selection diagnostics"
      className="border-border bg-muted/20 space-y-2 rounded border p-3 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-foreground">
          G5 Tool Decisions ({toolSelection.schema_version})
          {occurredAtMs != null && occurredAtMs > 0
            ? ` · ${new Date(occurredAtMs).toLocaleTimeString()}`
            : ""}
        </p>
        {order_hash && (
          <span className="text-muted-foreground font-mono text-[11px]">
            order {order_hash.slice(0, 8)}
          </span>
        )}
      </div>

      {isZeroCapWithRequired ? (
        <div
          role="alert"
          className="border-destructive/50 bg-destructive/10 text-destructive rounded border p-2 font-medium"
        >
          Zero cap with required tools: incompatible tool budget (execution blocked)
        </div>
      ) : (
        <p className="text-muted-foreground">
          {effective_cap == null || cap_source === "unset" ? (
            <span className="font-medium text-foreground">Cap: unset</span>
          ) : effective_cap === 0 ? (
            <span className="font-medium text-foreground">Cap: 0 (tools disabled)</span>
          ) : (
            <span className="font-medium text-foreground">
              Cap: {effective_cap} ({cap_source ?? "source not reported"})
            </span>
          )}
        </p>
      )}

      <p className="text-muted-foreground">
        Schemas: {checked_count ?? "unknown"} checked · {eligible_count ?? "unknown"} eligible ·{" "}
        {selected_count ?? "unknown"} selected · {rejected_count ?? "unknown"} rejected
      </p>

      <p className="text-muted-foreground text-[11px]">
        Breakdown: {required_count} required · {context_count} context · {optional_count} optional ·{" "}
        {global_count} global
      </p>

      {(selected_omitted > 0 || rejected_omitted > 0) && (
        <p className="text-muted-foreground text-[11px]">
          Omissions:{" "}
          {selected_omitted > 0
            ? `${selected_omitted} selected schemas omitted (total: ${selected_total ?? selected_count ?? "unknown"})`
            : ""}
          {selected_omitted > 0 && rejected_omitted > 0 ? " · " : ""}
          {rejected_omitted > 0
            ? `${rejected_omitted} rejected schemas omitted (total: ${rejected_total ?? rejected_count ?? "unknown"})`
            : ""}
        </p>
      )}

      {Object.keys(reason_counts).length > 0 && (
        <div className="space-y-1">
          <p className="font-medium text-muted-foreground">Decision reasons:</p>
          <ul className="flex flex-wrap gap-2">
            {Object.entries(reason_counts).map(([reasonCode, count]) => (
              <li
                key={reasonCode}
                className="border-border bg-card rounded border px-2 py-0.5 text-[11px]"
              >
                <span className="font-medium">{formatToolReason(reasonCode)}:</span> {count}
              </li>
            ))}
          </ul>
        </div>
      )}

      {name_details_redacted ? (
        <p className="text-muted-foreground italic text-[11px]">
          Tool names redacted (requires exact-scope authorization).
        </p>
      ) : (
        <div className="space-y-2">
          {selected_tools && selected_tools.length > 0 && (
            <div>
              <p className="font-medium text-foreground">Selected tools ({selected_tools.length}):</p>
              <ul className="mt-1 space-y-1">
                {selected_tools.map((tool) => (
                  <li
                    key={tool.canonical_name}
                    className="border-border bg-card rounded border px-2 py-1 font-mono text-[11px]"
                  >
                    <span className="font-semibold text-foreground">{tool.canonical_name}</span>
                    <span className="text-muted-foreground font-sans">
                      {" "}
                      — {formatToolReason(tool.reason_code ?? tool.reason)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {rejected_tools && rejected_tools.length > 0 && (
            <div>
              <p className="font-medium text-muted-foreground">
                Rejected tools ({rejected_tools.length}):
              </p>
              <ul className="mt-1 space-y-1">
                {rejected_tools.map((tool) => (
                  <li
                    key={tool.canonical_name}
                    className="border-border bg-card/60 rounded border px-2 py-1 font-mono text-[11px]"
                  >
                    <span className="text-muted-foreground">{tool.canonical_name}</span>
                    <span className="text-muted-foreground font-sans">
                      {" "}
                      — {formatToolReason(tool.reason_code ?? tool.reason)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
