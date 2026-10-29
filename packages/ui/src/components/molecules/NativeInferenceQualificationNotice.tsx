import * as React from "react";
import { TriangleAlert } from "lucide-react";

/** Qualification disclosure only; readiness and admission remain authoritative. */
export function NativeInferenceQualificationNotice() {
  return (
    <aside
      role="note"
      aria-label="Managed native inference qualification"
      className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs"
    >
      <div className="flex flex-col items-start gap-2 sm:flex-row">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 space-y-1 break-words">
          <p className="font-medium text-foreground">
            Managed native inference: qualification incomplete
          </p>
          <p className="text-muted-foreground">
            The current engine can run with tested profiles. Model readiness is not full production
            qualification; hardware capacity and capability checks still apply.
          </p>
          <details className="pt-1">
            <summary className="min-h-11 w-fit cursor-pointer rounded py-3 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Known limitations
            </summary>
            <ul className="mt-2 list-disc space-y-1.5 pl-4 text-muted-foreground">
              <li>
                Native KV types, device placement, Flash Attention, sliding-window and recurrent
                settings are not all independently read back from the engine.
              </li>
              <li>
                Some Flash Attention and CPU-KV profiles fail exact cache-restore parity and remain
                unqualified. A passing profile does not qualify other configurations.
              </li>
              <li>
                Qwen may need to recompute a prompt when a tool-session checkpoint is no longer a
                valid prefix after a new user message.
              </li>
            </ul>
          </details>
        </div>
      </div>
    </aside>
  );
}
