import type { RunEventDto } from "@nonclaw-ui/shared/types";

function timestamp(ms: number) {
  return new Date(ms).toLocaleString();
}

export function RunTimeline({ events }: { events: RunEventDto[] }) {
  return (
    <ol aria-label="Run event timeline" className="border-border space-y-2 border-l pl-4">
      {events.slice(0, 500).map((event) => (
        <li key={event.event_id} className="relative text-sm">
          <span
            aria-hidden
            className="bg-primary absolute -left-[1.31rem] top-1.5 size-2 rounded-full"
          />
          <p className="font-medium">
            {event.event_kind}
            {event.lifecycle_status ? ` — ${event.lifecycle_status}` : ""}
          </p>
          <p
            className="text-muted-foreground text-xs"
            title={`${event.occurred_at_ms} ms since epoch`}
          >
            {timestamp(event.occurred_at_ms)} · sequence {event.event_seq}
          </p>
          {event.safe_error_code && (
            <p className="text-destructive text-xs">Safe error: {event.safe_error_code}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
