import * as React from "react";

export type UserQuestionKind = "single_choice" | "short_text" | "multiline";

export interface UserQuestionOption {
  readonly id: string;
  readonly label: string;
}

export interface UserQuestionCardQuestion {
  /** Runtime values stay open so a newer kind can fail closed in the UI. */
  readonly kind: string;
  readonly prompt: string;
  readonly help?: string | null;
  readonly options?: readonly UserQuestionOption[];
}

export interface UserQuestionCardProps {
  readonly question: UserQuestionCardQuestion;
  /** The controller owns this draft; the card never stores it. */
  readonly draft: string;
  readonly onDraftChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
  readonly onCancel: () => void;
  readonly disabled?: boolean;
  readonly submitting?: boolean;
  readonly error?: string | null;
  readonly status?: string | null;
  /** Focus the first native control after a genuinely new question is mounted. */
  readonly focus?: boolean;
}

const CARD_CLASS =
  "border-border bg-card space-y-4 rounded-lg border p-4 text-card-foreground shadow-sm";
const CONTROL_CLASS =
  "flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const ACTION_CLASS =
  "inline-flex min-h-10 items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

function isSupportedQuestionKind(kind: string): kind is UserQuestionKind {
  return kind === "single_choice" || kind === "short_text" || kind === "multiline";
}

export function UserQuestionCard({
  question,
  draft,
  onDraftChange,
  onSubmit,
  onCancel,
  disabled = false,
  submitting = false,
  error = null,
  status = null,
  focus = false,
}: UserQuestionCardProps) {
  const id = React.useId().replace(/:/g, "");
  const headingId = `${id}-heading`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const firstControlRef = React.useRef<HTMLElement | null>(null);
  const setFirstControlRef = (element: HTMLInputElement | HTMLTextAreaElement | null): void => {
    firstControlRef.current = element;
  };
  const supported = isSupportedQuestionKind(question.kind);
  const controlsDisabled = disabled || submitting;
  const describedBy = [question.help ? helpId : null, error ? errorId : null]
    .filter((value): value is string => value !== null)
    .join(" ");
  const statusMessage = !supported
    ? status
      ? `Unsupported question type. ${status}`
      : "Unsupported question type."
    : (status ?? (submitting ? "Submitting…" : "Please provide input."));

  React.useEffect(() => {
    if (focus && supported && !controlsDisabled) {
      firstControlRef.current?.focus();
    }
  }, [controlsDisabled, focus, question.kind, supported]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supported || controlsDisabled) return;
    onSubmit(draft);
  };

  const feedback = (
    <>
      {statusMessage && (
        <p
          id={`${id}-status`}
          role="status"
          aria-live="polite"
          className="text-muted-foreground text-xs"
        >
          {statusMessage}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </>
  );

  const cancelAction = (
    <button
      type="button"
      onClick={onCancel}
      disabled={controlsDisabled}
      className={`${ACTION_CLASS} border-input bg-background hover:bg-accent hover:text-accent-foreground border`}
    >
      Cancel
    </button>
  );

  return (
    <article aria-labelledby={headingId} aria-busy={submitting} className={CARD_CLASS}>
      <header className="space-y-2">
        <h2 id={headingId} className="text-base font-semibold">
          Agent question
        </h2>
        <p className="text-muted-foreground text-xs">Input only — does not authorize actions.</p>
      </header>

      {supported ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          {question.kind === "single_choice" ? (
            <fieldset
              disabled={controlsDisabled}
              aria-describedby={describedBy || undefined}
              aria-invalid={error ? true : undefined}
              className="border-border min-w-0 space-y-3 rounded-md border p-3"
            >
              <legend className="px-1 text-sm font-medium">{question.prompt}</legend>
              {question.help && (
                <p id={helpId} className="text-muted-foreground whitespace-pre-wrap text-xs">
                  {question.help}
                </p>
              )}
              <div className="space-y-2">
                {(question.options ?? []).map((option, index) => {
                  const optionId = `${id}-option-${index}`;
                  return (
                    <label
                      key={optionId}
                      htmlFor={optionId}
                      className="border-border hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors"
                    >
                      <input
                        ref={index === 0 ? setFirstControlRef : undefined}
                        id={optionId}
                        name={`${id}-answer`}
                        type="radio"
                        value={option.id}
                        checked={draft === option.id}
                        onChange={(event) => onDraftChange(event.currentTarget.value)}
                        required={index === 0}
                        className="accent-primary mt-1 h-4 w-4 shrink-0"
                      />
                      <span className="whitespace-pre-wrap break-words text-sm">
                        {option.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : (
            <div className="space-y-2">
              <label htmlFor={`${id}-answer`} className="text-sm font-medium">
                {question.prompt}
              </label>
              {question.help && (
                <p id={helpId} className="text-muted-foreground whitespace-pre-wrap text-xs">
                  {question.help}
                </p>
              )}
              {question.kind === "short_text" ? (
                <input
                  ref={setFirstControlRef}
                  id={`${id}-answer`}
                  name={`${id}-answer`}
                  type="text"
                  value={draft}
                  onChange={(event) => onDraftChange(event.currentTarget.value)}
                  required
                  maxLength={256}
                  aria-describedby={describedBy || undefined}
                  aria-invalid={error ? true : undefined}
                  disabled={controlsDisabled}
                  className={CONTROL_CLASS}
                />
              ) : (
                <textarea
                  ref={setFirstControlRef}
                  id={`${id}-answer`}
                  name={`${id}-answer`}
                  value={draft}
                  onChange={(event) => onDraftChange(event.currentTarget.value)}
                  required
                  maxLength={2048}
                  aria-describedby={describedBy || undefined}
                  aria-invalid={error ? true : undefined}
                  disabled={controlsDisabled}
                  rows={4}
                  className={`${CONTROL_CLASS} resize-y`}
                />
              )}
            </div>
          )}

          {feedback}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="submit"
              disabled={controlsDisabled}
              className={`${ACTION_CLASS} bg-primary text-primary-foreground hover:bg-primary/90`}
            >
              Answer
            </button>
            {cancelAction}
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="border-border bg-muted/40 space-y-2 rounded-md border border-dashed p-3">
            <p className="text-sm font-medium">This question type is not supported.</p>
            <p className="whitespace-pre-wrap break-words text-sm">{question.prompt}</p>
            {question.help && (
              <p id={helpId} className="text-muted-foreground whitespace-pre-wrap text-xs">
                {question.help}
              </p>
            )}
          </div>
          {feedback}
          <div className="flex justify-end">{cancelAction}</div>
        </div>
      )}
    </article>
  );
}

UserQuestionCard.displayName = "UserQuestionCard";
