/**
 * Form fields of the direct-template image action (split from `DirectImageTemplateAction` so the
 * container keeps only submit/job/focus logic). Purely presentational: controls shown follow the
 * template's `editable_fields`; inline errors are `role="alert"` and tied to their field through
 * `aria-describedby` only while a message exists.
 */
import type { RefObject } from "react";
import {
  IMAGE_MAX_NEGATIVE_PROMPT_BYTES,
  IMAGE_MAX_PROMPT_BYTES,
  type ImageTemplateSummary,
} from "@eigen-air-ui/shared/types";
import {
  IMAGE_COUNT_OPTIONS,
  IMAGE_NAMED_SIZE_OPTIONS,
  IMAGE_QUALITY_OPTIONS,
  isFieldEditable,
  utf8ByteLength,
  type DirectImageFieldErrors,
  type DirectImageForm,
} from "./direct-image-request.js";

const FIELD_CLASS =
  "border-input bg-background focus-visible:ring-ring w-full rounded-md border px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2";

/** Focus targets the container needs (first control and first-invalid-field focus). */
export interface DirectImageFieldRefs {
  template: RefObject<HTMLSelectElement | null>;
  prompt: RefObject<HTMLTextAreaElement | null>;
  negativePrompt: RefObject<HTMLTextAreaElement | null>;
  seed: RefObject<HTMLInputElement | null>;
}

export interface DirectImageTemplateFieldsProps {
  idPrefix: string;
  templates: readonly ImageTemplateSummary[];
  template: ImageTemplateSummary;
  form: DirectImageForm;
  errors: DirectImageFieldErrors;
  /** Prompt error to show (submit validation or live over-limit text). */
  promptError: string | undefined;
  refs: DirectImageFieldRefs;
  onChange(patch: Partial<DirectImageForm>): void;
  onTemplateSelect(templateId: string): void;
}

export function DirectImageTemplateFields({
  idPrefix,
  templates,
  template,
  form,
  errors,
  promptError,
  refs,
  onChange,
  onTemplateSelect,
}: DirectImageTemplateFieldsProps) {
  const fieldId = (name: string) => `${idPrefix}-${name}`;
  const editable = (field: string) => isFieldEditable(template, field);
  const canPrompt = editable("prompt");

  return (
    <>
      <div className="space-y-1">
        <label htmlFor={fieldId("template")} className="text-xs font-medium">
          Template
        </label>
        <select
          id={fieldId("template")}
          ref={refs.template}
          className={FIELD_CLASS}
          value={form.templateId}
          aria-describedby={fieldId("template-description")}
          onChange={(event) => onTemplateSelect(event.target.value)}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <p id={fieldId("template-description")} className="text-muted-foreground text-xs">
          {template.description}
        </p>
      </div>

      {!canPrompt && (
        <p className="text-muted-foreground text-xs">This template does not accept a prompt.</p>
      )}

      {canPrompt && (
        <TextAreaField
          id={fieldId("prompt")}
          label="Prompt"
          rows={3}
          inputRef={refs.prompt}
          value={form.prompt}
          maxBytes={IMAGE_MAX_PROMPT_BYTES}
          error={promptError}
          onChange={(prompt) => onChange({ prompt })}
        />
      )}

      {editable("negative_prompt") && (
        <TextAreaField
          id={fieldId("negative")}
          label="Negative prompt (optional)"
          rows={2}
          inputRef={refs.negativePrompt}
          value={form.negativePrompt}
          maxBytes={IMAGE_MAX_NEGATIVE_PROMPT_BYTES}
          error={errors.negativePrompt}
          onChange={(negativePrompt) => onChange({ negativePrompt })}
        />
      )}

      <div className="grid grid-cols-2 gap-2">
        {editable("quality") && (
          <SelectField
            id={fieldId("quality")}
            label="Quality"
            value={form.quality}
            options={IMAGE_QUALITY_OPTIONS}
            onChange={(quality) => onChange({ quality })}
          />
        )}
        {editable("size") && (
          <SelectField
            id={fieldId("size")}
            label="Size"
            value={form.size}
            options={
              IMAGE_NAMED_SIZE_OPTIONS.includes(template.defaults.size)
                ? IMAGE_NAMED_SIZE_OPTIONS
                : [template.defaults.size, ...IMAGE_NAMED_SIZE_OPTIONS]
            }
            onChange={(size) => onChange({ size })}
          />
        )}
        {editable("n") && (
          <SelectField
            id={fieldId("n")}
            label="Images"
            value={form.n}
            options={IMAGE_COUNT_OPTIONS.map(String)}
            onChange={(n) => onChange({ n })}
          />
        )}
        {editable("seed") && (
          <div className="space-y-1">
            <label htmlFor={fieldId("seed")} className="text-xs font-medium">
              Seed (optional)
            </label>
            <input
              id={fieldId("seed")}
              ref={refs.seed}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className={FIELD_CLASS}
              value={form.seed}
              aria-invalid={errors.seed !== undefined}
              aria-describedby={errors.seed ? fieldId("seed-error") : undefined}
              onChange={(event) => onChange({ seed: event.target.value })}
            />
            <FieldError id={fieldId("seed-error")} message={errors.seed} />
          </div>
        )}
      </div>
    </>
  );
}

/** Alert region that exists only while it has a message (so it is announced when it appears). */
function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-xs">
      {message}
    </p>
  );
}

function TextAreaField({
  id,
  label,
  rows,
  inputRef,
  value,
  maxBytes,
  error,
  onChange,
}: {
  id: string;
  label: string;
  rows: number;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  maxBytes: number;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const bytes = utf8ByteLength(value);
  const countId = `${id}-count`;
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <textarea
        id={id}
        ref={inputRef}
        rows={rows}
        className={FIELD_CLASS}
        value={value}
        aria-invalid={error !== undefined}
        aria-describedby={error ? `${countId} ${errorId}` : countId}
        onChange={(event) => onChange(event.target.value)}
      />
      <p
        id={countId}
        className={bytes > maxBytes ? "text-destructive text-xs" : "text-muted-foreground text-xs"}
      >
        {bytes} / {maxBytes} bytes
      </p>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function SelectField({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <select
        id={id}
        className={FIELD_CLASS}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
