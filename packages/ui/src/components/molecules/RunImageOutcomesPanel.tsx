import * as React from "react";
import { useImageArtifactStore } from "../../stores/image-artifact-store.js";
import {
  getTrackedImageJob,
  useImageCapabilities,
  useImageCapabilityCheck,
  useImageHistorySync,
  useSessionImageGroups,
  useTrackedImageJobs,
} from "../../stores/use-image-history.js";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";
import { ChatImageRunGroup } from "./ChatImageRunGroup.js";
import {
  IMAGE_CANCEL_FAILED_MESSAGE,
  IMAGE_CAPABILITY_CHECK_LABEL,
  IMAGE_CAPABILITY_FAILED_MESSAGE,
  imageJobSummary,
  isImageJobActive,
  useNoticeFocusHandoff,
  useReportFocusLost,
  type NoticeFocusHandoff,
  type NoticePhase,
} from "./image-ui-messages.js";

export interface RunImageOutcomesPanelProps {
  sessionId: string;
  runId: string;
}

/** The panel binds nothing to messages: every group of the session comes back as `unbound`. */
const NO_MESSAGES: readonly never[] = [];

type NoticeKind = "capability" | "listing";

/** Failure notice with a recovery button; reports when it unmounts while holding focus. */
function RecoveryNotice({
  handoff,
  kind,
  children,
}: {
  handoff: NoticeFocusHandoff<NoticeKind>;
  kind: NoticeKind;
  children: React.ReactNode;
}) {
  const { onFocus } = useReportFocusLost(handoff, kind);
  return (
    <div ref={handoff.boxRef} onFocus={onFocus} className="flex flex-wrap items-center gap-2">
      {children}
    </div>
  );
}

/**
 * Images and tracked image jobs of one run, for the run inspector. Owns the session sync
 * (`useImageHistorySync`). Renders nothing while the historical readers are known to be off (or
 * not read yet). A capability read that FAILED shows a fixed notice with a "Check again" button
 * instead of silently hiding the history. Cancel failures show a fixed alert; the job's real
 * state stays in its row (never reported as cancelled before a terminal snapshot); the alert
 * goes once that job is no longer cancelable.
 *
 * "Check again" / "Retry" unmount their own button as soon as the recovery starts: if it held
 * focus, focus returns to a reappearing notice or, once recovered, to the section heading
 * (`tabIndex -1`); focus the user moved elsewhere meanwhile is left alone.
 */
export function RunImageOutcomesPanel({ sessionId, runId }: RunImageOutcomesPanelProps) {
  useImageHistorySync(sessionId);
  const capabilities = useImageCapabilities();
  const check = useImageCapabilityCheck(sessionId);
  const status = useImageArtifactStore((s) => s.status);
  const activeSessionId = useImageArtifactStore((s) => s.activeSessionId);
  const { unbound } = useSessionImageGroups(NO_MESSAGES);
  const trackedJobs = useTrackedImageJobs();
  const [cancelling, setCancelling] = React.useState<ReadonlySet<string>>(new Set());
  /** The job whose last cancel did not take effect (ordinal = its 1-based position in the list). */
  const [cancelFailure, setCancelFailure] = React.useState<{
    jobId: string;
    ordinal: number;
    /** The job was still tracked when the cancel returned. */
    tracked: boolean;
  } | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const owned = activeSessionId === sessionId;
  const groups = React.useMemo(
    () => (owned ? unbound.filter((g) => g.sessionId === sessionId && g.runId === runId) : []),
    [owned, unbound, sessionId, runId]
  );
  const jobs = React.useMemo(
    () =>
      owned ? trackedJobs.filter((j) => j.session_id === sessionId && j.run_id === runId) : [],
    [owned, trackedJobs, sessionId, runId]
  );

  const cancelJob = async (jobId: string, ordinal: number, button: HTMLElement) => {
    if (cancelling.has(jobId)) return;
    setCancelFailure(null);
    setCancelling((current) => new Set(current).add(jobId));
    const row = button.closest("li");
    try {
      await useImageArtifactStore.getState().cancelJob(jobId);
    } finally {
      if (mounted.current) {
        setCancelling((current) => {
          const next = new Set(current);
          next.delete(jobId);
          return next;
        });
      }
    }
    if (!mounted.current) return;
    // A 202 yields `cancel_requested` (or a terminal state if the job just finished). Anything
    // else, including a dropped job, means the request did not take effect.
    const after = getTrackedImageJob(jobId);
    if (!after || (isImageJobActive(after) && after.state !== "cancel_requested")) {
      setCancelFailure({ jobId, ordinal, tracked: after !== undefined });
    }
    // The pressed button unmounts once the job is `cancel_requested`: keep keyboard focus in the
    // row, but only if it was dropped to the body (never steal it from where the user went).
    if (document.activeElement === document.body && row?.isConnected) row.focus();
  };

  // Recovery notices: shown only while the historical readers are advertised or a capability read
  // failed (then availability is unknown, not off). `phase` drives the focus handoff below.
  const failed = status === "unavailable" || status === "error";
  const loading = !owned || status === "idle" || status === "loading";
  const shown =
    !(capabilities.status === "known" && !capabilities.readers) &&
    (check.failed || capabilities.readers);
  const failureKind: NoticeKind | null = !shown
    ? null
    : check.failed
      ? "capability"
      : failed || status === "stale"
        ? "listing"
        : null;
  const phase: NoticePhase =
    failureKind !== null
      ? "failed"
      : !shown
        ? capabilities.status === "known"
          ? "done"
          : "busy"
        : loading
          ? "busy"
          : "done";
  const handoff = useNoticeFocusHandoff<NoticeKind>(
    phase,
    `${sessionId}:${runId}`,
    () => headingRef.current
  );

  // L6: the alert describes a job that is still cancelable. Once that job reached a terminal state,
  // became `cancel_requested` or was dropped from the tracker after having been seen, it goes.
  // (A job that was already gone when the cancel returned keeps its alert until the next attempt.)
  const failedJob = cancelFailure ? jobs.find((j) => j.job_id === cancelFailure.jobId) : undefined;
  const shownCancelFailure =
    cancelFailure !== null &&
    (failedJob
      ? isImageJobActive(failedJob) && failedJob.state !== "cancel_requested"
      : !cancelFailure.tracked)
      ? cancelFailure
      : null;

  if (!shown) return null; // readers known off, not read yet, or never advertised

  const retry = () => void useImageArtifactStore.getState().refreshSession(sessionId);
  const hasContent = groups.length > 0 || jobs.length > 0;

  let notice: React.ReactNode = null;
  if (failureKind === "capability") {
    notice = (
      <RecoveryNotice handoff={handoff} kind="capability">
        <p role="status" className="text-muted-foreground text-sm">
          {IMAGE_CAPABILITY_FAILED_MESSAGE}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={check.checking || undefined}
          aria-busy={check.checking || undefined}
          onClick={check.check}
        >
          {IMAGE_CAPABILITY_CHECK_LABEL}
        </Button>
      </RecoveryNotice>
    );
  } else if (failureKind === "listing") {
    notice = (
      <RecoveryNotice handoff={handoff} kind="listing">
        <p role="status" className="text-muted-foreground text-sm">
          {failed ? "Image history is unavailable." : "Image history could not be refreshed."}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          Retry
        </Button>
      </RecoveryNotice>
    );
  } else if (loading && !hasContent) {
    notice = (
      <div role="status" className="text-muted-foreground flex items-center gap-2 text-sm">
        <Spinner size="sm" aria-hidden="true" />
        Loading images…
      </div>
    );
  } else if (!hasContent) {
    notice = <p className="text-muted-foreground text-sm">No images were produced by this run.</p>;
  }

  return (
    <section aria-labelledby="run-image-outcomes-heading" className="space-y-2">
      <h3
        ref={headingRef}
        id="run-image-outcomes-heading"
        tabIndex={-1}
        className="text-sm font-semibold focus:outline-none"
      >
        Image outputs
      </h3>
      {notice}
      {shownCancelFailure && (
        <p role="alert" className="text-destructive text-xs">
          {IMAGE_CANCEL_FAILED_MESSAGE} (image job {shownCancelFailure.ordinal})
        </p>
      )}
      {jobs.length > 0 && (
        <ul className="space-y-1">
          {jobs.map((job, index) => {
            const ordinal = index + 1;
            const busy = cancelling.has(job.job_id);
            return (
              <li
                key={job.job_id}
                tabIndex={-1}
                className="border-border flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-xs focus:outline-none"
              >
                <span>{imageJobSummary(job)}</span>
                {isImageJobActive(job) && job.state !== "cancel_requested" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`${busy ? "Cancelling" : "Cancel"} image job ${ordinal}`}
                    aria-disabled={busy || undefined}
                    aria-busy={busy || undefined}
                    onClick={(event) => void cancelJob(job.job_id, ordinal, event.currentTarget)}
                  >
                    {busy ? "Cancelling…" : "Cancel"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {groups.map((group) => (
        <ChatImageRunGroup
          key={`${group.sessionId}:${group.runId}`}
          group={group}
          className="px-0 pb-0"
        />
      ))}
    </section>
  );
}

RunImageOutcomesPanel.displayName = "RunImageOutcomesPanel";
