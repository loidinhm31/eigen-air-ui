import * as React from "react";
import { X } from "lucide-react";
import { IMAGE_MAX_PROMPT_BYTES, type ImageTemplateSummary } from "@eigen-air-ui/shared/types";
import { getArtifactService } from "../../adapters/factory/ServiceFactory.js";
import { useImageArtifactStore } from "../../stores/image-artifact-store.js";
import { useTrackedImageJobs } from "../../stores/use-image-history.js";
import { Button } from "../atoms/Button.js";
import { Spinner } from "../atoms/Spinner.js";
import {
  buildDirectImageRequest,
  directImageSubmissions,
  formForTemplate,
  isFieldEditable,
  pickDirectImageJob,
  utf8ByteLength,
  type DirectImageDraftUpdate,
  type DirectImageFieldErrors,
  type DirectImageForm,
} from "./direct-image-request.js";
import {
  DirectImageTemplateFields,
  type DirectImageFieldRefs,
} from "./direct-image-template-fields.js";
import { ChatImageRunGroup } from "./ChatImageRunGroup.js";
import {
  describeImageActionError,
  imageErrorKindMessage,
  imageJobProgress,
  imageJobSummary,
  isImageJobActive,
} from "./image-ui-messages.js";

export interface DirectImageTemplateActionProps {
  sessionId: string;
  /** Close button / Escape. The caller owns restoring focus to its trigger. */
  onClose: () => void;
  /**
   * The in-memory draft kept by the surviving owner (`useDirectImageDraft`), so Escape/Close does
   * not lose what was typed. `null`: nothing typed yet (the first template's defaults are shown).
   */
  draft: DirectImageForm | null;
  onDraftChange: (update: DirectImageDraftUpdate) => void;
}

type TemplatesState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; templates: ImageTemplateSummary[] };

/**
 * Inline panel for the direct-template image action. Availability is decided by the caller
 * (`useImageCapabilities().generation`), never by chat provider readiness.
 *
 * Job state lives in the image store, not in this component:
 * - The shown job is the newest ACTIVE tracked `direct_template` job of `sessionId` (else the
 *   newest one, showing its terminal state), so closing/reopening the panel keeps status and
 *   Cancel, but only while the chat route stays mounted: Slice B deselects the session's job
 *   tracker when its last consumer unmounts, so after Chat -> Runs -> Chat the status is gone and
 *   the finished images arrive through the history listing. Generate stays disabled while any such
 *   job is active; with several active jobs (only possible when created elsewhere) the newest is
 *   shown and cancelable first, then the next.
 * - A `createJob` in flight is NOT aborted on close (the server may already have created the
 *   job): it resolves into `trackJob` (the store ignores other sessions) and a module-level
 *   registry keeps a re-opened panel from submitting a second job meanwhile.
 *
 * Focus: the status node (`data-image-action-status`, tabIndex -1, polite live region) takes focus
 * when a submit/cancel disables the focused control, but only if focus is still inside the panel;
 * it precedes Generate/Cancel in tab order. The first field takes focus on load only if the user
 * has not moved elsewhere.
 *
 * The form is a controlled view of `draft`, which the surviving owner keeps in memory (Escape and
 * Close unmount this panel). Typed text is only ever the value of its own fields.
 */
export function DirectImageTemplateAction({
  sessionId,
  onClose,
  draft,
  onDraftChange,
}: DirectImageTemplateActionProps) {
  const [templates, setTemplates] = React.useState<TemplatesState>({ phase: "loading" });
  const [loadAttempt, setLoadAttempt] = React.useState(0);
  const form = React.useMemo(() => {
    if (templates.phase !== "ready") return null;
    // A draft survives the panel; its template may have disappeared meanwhile: keep the typed
    // text on the first template then.
    if (draft && templates.templates.some((t) => t.id === draft.templateId)) return draft;
    const first = templates.templates[0];
    return first ? formForTemplate(first, draft ?? undefined) : null;
  }, [templates, draft]);
  const [errors, setErrors] = React.useState<DirectImageFieldErrors>({});
  const [attempted, setAttempted] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<{
    sessionId: string;
    message: string;
  } | null>(null);
  const [cancelError, setCancelError] = React.useState<{ jobId: string; message: string } | null>(
    null
  );
  const [cancelling, setCancelling] = React.useState(false);
  const regionRef = React.useRef<HTMLElement>(null);
  const statusRef = React.useRef<HTMLDivElement>(null);
  const fieldRefs: DirectImageFieldRefs = {
    template: React.useRef<HTMLSelectElement>(null),
    prompt: React.useRef<HTMLTextAreaElement>(null),
    negativePrompt: React.useRef<HTMLTextAreaElement>(null),
    seed: React.useRef<HTMLInputElement>(null),
  };
  const ids = React.useId();

  const trackedJobs = useTrackedImageJobs();
  const job = React.useMemo(
    () => pickDirectImageJob(trackedJobs, sessionId),
    [trackedJobs, sessionId]
  );
  const jobActive = job !== undefined && isImageJobActive(job);
  const submitting = React.useSyncExternalStore(directImageSubmissions.subscribe, () =>
    directImageSubmissions.isPending(sessionId)
  );

  React.useEffect(() => {
    regionRef.current?.focus(); // Escape works from the first moment; fields take focus once loaded
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    getArtifactService()
      .listTemplates({ signal: controller.signal })
      .then(
        (list) => {
          if (controller.signal.aborted) return;
          setTemplates({ phase: "ready", templates: list.templates });
        },
        (error: unknown) => {
          if (!controller.signal.aborted) {
            setTemplates({ phase: "error", message: describeImageActionError(error) });
          }
        }
      );
    return () => controller.abort();
  }, [loadAttempt]);

  const ready = templates.phase === "ready" && form !== null;
  React.useEffect(() => {
    if (!ready) return;
    // Never steal focus from a control the user already moved to.
    const active = document.activeElement;
    if (active === null || active === document.body || active === regionRef.current) {
      fieldRefs.template.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable
  }, [ready]);

  const template =
    templates.phase === "ready" && form
      ? templates.templates.find((t) => t.id === form.templateId)
      : undefined;
  const canPrompt = template !== undefined && isFieldEditable(template, "prompt");

  const update = (patch: Partial<DirectImageForm>) => {
    if (!form) return;
    onDraftChange((current) => ({ ...patchBase(current, form), ...patch }));
    if (attempted) setErrors((e) => ({ ...e, ...clearedErrors(patch) }));
  };

  /** Keep keyboard focus in the panel when the focused control is about to be disabled/removed. */
  const keepFocusInPanel = (target: HTMLElement | null) => {
    if (regionRef.current?.contains(document.activeElement)) target?.focus();
  };

  const focusFirstInvalid = (found: DirectImageFieldErrors) => {
    const target = found.prompt
      ? fieldRefs.prompt.current
      : found.negativePrompt
        ? fieldRefs.negativePrompt.current
        : found.seed
          ? fieldRefs.seed.current
          : null;
    target?.focus();
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!template || !form || submitting || jobActive || !canPrompt) return;
    setAttempted(true);
    setSubmitError(null);
    const built = buildDirectImageRequest(template, form, sessionId);
    if ("errors" in built) {
      setErrors(built.errors);
      focusFirstInvalid(built.errors);
      return;
    }
    setErrors({});
    if (!directImageSubmissions.begin(sessionId)) return;
    const submittedDraft = draft;
    keepFocusInPanel(statusRef.current);
    try {
      // Deliberately not abortable: after the panel closes the server may still create the job.
      // `createJob` has no deadline either (adapter: no timeout, no signal passed here), so a
      // hung request keeps this session "Submitting…" until the fetch settles; the registry is
      // module-level and survives unmounts, only a page reload clears it.
      const snapshot = await getArtifactService().createJob(built.request);
      // The job exists: the draft is spent. Cleared only if the user has not edited it since (the
      // panel may have been closed and reopened while the request was in flight).
      onDraftChange((current) => (current === submittedDraft ? null : current));
      const store = useImageArtifactStore.getState();
      if (snapshot.session_id === sessionId && store.activeSessionId === sessionId) {
        store.trackJob(snapshot);
      }
    } catch (error) {
      setSubmitError({ sessionId, message: describeImageActionError(error) });
    } finally {
      directImageSubmissions.end(sessionId);
    }
  };

  const onCancel = async () => {
    if (!job || cancelling) return;
    keepFocusInPanel(statusRef.current);
    setCancelling(true);
    setCancelError(null);
    try {
      const store = useImageArtifactStore.getState();
      await store.cancelJob(job.job_id);
      // Success always advances the tracked snapshot (cancel_requested or terminal); `lastError`
      // alone may be left over from an unrelated listing failure.
      const { lastError, jobs } = useImageArtifactStore.getState();
      const after = Object.hasOwn(jobs, job.job_id) ? jobs[job.job_id] : undefined;
      if (lastError !== undefined && (after === undefined || after.revision === job.revision)) {
        setCancelError({ jobId: job.job_id, message: imageErrorKindMessage(lastError) });
      }
    } finally {
      setCancelling(false);
    }
  };

  const retryTemplates = () => {
    keepFocusInPanel(regionRef.current);
    setTemplates({ phase: "loading" });
    setLoadAttempt((attempt) => attempt + 1);
  };

  const promptBytes = form ? utf8ByteLength(form.prompt) : 0;
  const promptError =
    errors.prompt ??
    (promptBytes > IMAGE_MAX_PROMPT_BYTES
      ? `Prompt is too long (max ${IMAGE_MAX_PROMPT_BYTES} bytes).`
      : undefined);
  const shownSubmitError = submitError?.sessionId === sessionId ? submitError.message : undefined;
  const shownCancelError =
    job !== undefined && cancelError?.jobId === job.job_id ? cancelError.message : undefined;
  const statusText = submitting ? "Submitting image job…" : job ? imageJobSummary(job) : "";
  const jobProgress = job ? imageJobProgress(job) : null;

  return (
    <section
      ref={regionRef}
      role="region"
      aria-label="Generate image"
      tabIndex={-1}
      data-image-action-region=""
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      // Header and actions stay put; the field body scrolls (viewport minus app header).
      className="bg-card flex max-h-[calc(100dvh-6rem)] min-h-0 flex-col text-sm focus:outline-none"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-2 pt-3">
        <h2 className="text-sm font-semibold">Generate image</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Close image generator"
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      {templates.phase === "loading" && (
        <div
          role="status"
          className="text-muted-foreground flex items-center gap-2 px-3 pb-3 text-xs"
        >
          <Spinner size="sm" aria-hidden="true" />
          Loading templates…
        </div>
      )}
      {templates.phase === "error" && (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          <p role="alert" className="text-destructive text-xs">
            {templates.message}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={retryTemplates}>
            Retry
          </Button>
        </div>
      )}
      {templates.phase === "ready" && templates.templates.length === 0 && (
        <p className="text-muted-foreground px-3 pb-3 text-xs">No image templates are available.</p>
      )}

      {templates.phase === "ready" && form && template && (
        <form
          onSubmit={(event) => void onSubmit(event)}
          className="flex min-h-0 flex-1 flex-col"
          noValidate
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
            <DirectImageTemplateFields
              idPrefix={ids}
              templates={templates.templates}
              template={template}
              form={form}
              errors={errors}
              promptError={promptError}
              refs={fieldRefs}
              onChange={update}
              onTemplateSelect={(templateId) => {
                const next = templates.templates.find((t) => t.id === templateId);
                if (next)
                  onDraftChange((current) => formForTemplate(next, patchBase(current, form)));
              }}
            />
          </div>

          <div className="border-border shrink-0 space-y-2 border-t px-3 py-2">
            {errors.form && (
              <p role="alert" className="text-destructive text-xs">
                {errors.form}
              </p>
            )}
            {shownSubmitError && (
              <p role="alert" className="text-destructive text-xs">
                {shownSubmitError}
              </p>
            )}
            {shownCancelError && (
              <p role="alert" className="text-destructive text-xs">
                {shownCancelError}
              </p>
            )}
            <div
              ref={statusRef}
              tabIndex={-1}
              aria-live="polite"
              data-image-action-status=""
              className="min-h-4 text-xs focus:outline-none"
            >
              {statusText}
            </div>
            {jobProgress && (
              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span
                    data-image-job-backend=""
                    className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px] font-medium"
                  >
                    {jobProgress.backendLabel}
                  </span>
                  <span
                    data-image-job-percent=""
                    className="font-mono text-xs font-medium tabular-nums"
                  >
                    {jobProgress.percent}%
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Image generation progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={jobProgress.percent}
                  className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
                >
                  <div
                    className="bg-primary h-full transition-all duration-300"
                    style={{ width: `${jobProgress.fillPercent}%` }}
                  />
                </div>
              </div>
            )}
            {job && job.artifacts.length > 0 && (
              <ChatImageRunGroup
                group={{
                  sessionId: job.session_id,
                  runId: job.run_id,
                  jobIds: [job.job_id],
                  toolCallIds: [],
                  items: job.artifacts,
                }}
                label="Generated images"
                className="px-0 pt-1 pb-0"
              />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={submitting || jobActive || !canPrompt}
                aria-busy={submitting}
              >
                {submitting ? "Submitting…" : "Generate"}
              </Button>
              {job && jobActive && job.state !== "cancel_requested" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={cancelling}
                  onClick={() => void onCancel()}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </form>
      )}
    </section>
  );
}

DirectImageTemplateAction.displayName = "DirectImageTemplateAction";

/**
 * Base of a draft patch. A draft whose template is gone is not displayed (the form is re-derived
 * from the first template), so patching it would silently drop the edit and, if it were kept,
 * mix in the vanished template's settings: use the displayed form unless the draft matches it.
 */
function patchBase(current: DirectImageForm | null, form: DirectImageForm): DirectImageForm {
  return current?.templateId === form.templateId ? current : form;
}

/** Editing a field clears that field's stale submit error. */
function clearedErrors(patch: Partial<DirectImageForm>): DirectImageFieldErrors {
  return {
    ...(patch.prompt !== undefined && { prompt: undefined }),
    ...(patch.negativePrompt !== undefined && { negativePrompt: undefined }),
    ...(patch.seed !== undefined && { seed: undefined }),
  };
}
