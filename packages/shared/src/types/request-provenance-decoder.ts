import type { PromptSectionSummaryDto, RequestProvenanceDto } from "./api.js";

export const REQUEST_PROVENANCE_SCHEMA = "request_provenance.v1";
export const MAX_REQUEST_PROVENANCE_BYTES = 4096;
export const MAX_LOGICAL_REQUEST_ID_BYTES = 128;
export const MAX_IDENTIFIER_BYTES = 128;
export const MAX_FORMAT_VERSION_BYTES = 64;
export const MAX_SECTIONS_COUNT = 32;

const ALLOWED_KEYS: Record<string, true> = {
  schema_version: true,
  logical_request_id: true,
  provider_id: true,
  provider_profile_id: true,
  provider_profile_revision: true,
  model: true,
  selected_skill_id: true,
  skill_content_revision: true,
  prompt_format_version: true,
  section_summaries: true,
};

const ALLOWED_SECTION_KEYS: Record<string, true> = {
  section: true,
  present: true,
  estimated_tokens: true,
  origin: true,
};

const VALID_SECTIONS: Record<string, true> = {
  identity: true,
  stable_core: true,
  tooling: true,
  tool_profile: true,
  safety: true,
  policy_profile: true,
  skill: true,
  skill_profile: true,
  workspace: true,
  memory: true,
  runtime: true,
  reminder: true,
  reminders: true,
};

export function decodeRequestProvenance(value: unknown): RequestProvenanceDto | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  // Reject arbitrary metadata / extra keys
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS[key]) {
      return null;
    }
  }
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_REQUEST_PROVENANCE_BYTES) {
      return null;
    }
  } catch {
    return null;
  }

  if (record.schema_version !== REQUEST_PROVENANCE_SCHEMA) {
    return null;
  }

  if (
    typeof record.logical_request_id !== "string" ||
    record.logical_request_id.length === 0 ||
    new TextEncoder().encode(record.logical_request_id).length > MAX_LOGICAL_REQUEST_ID_BYTES
  ) {
    return null;
  }

  if (
    typeof record.provider_id !== "string" ||
    record.provider_id.length === 0 ||
    new TextEncoder().encode(record.provider_id).length > MAX_IDENTIFIER_BYTES
  ) {
    return null;
  }

  if (
    record.provider_profile_id !== undefined &&
    record.provider_profile_id !== null &&
    (typeof record.provider_profile_id !== "string" ||
      record.provider_profile_id.length === 0 ||
      new TextEncoder().encode(record.provider_profile_id).length > MAX_IDENTIFIER_BYTES)
  ) {
    return null;
  }

  if (
    record.provider_profile_revision !== undefined &&
    record.provider_profile_revision !== null &&
    (typeof record.provider_profile_revision !== "number" ||
      !Number.isSafeInteger(record.provider_profile_revision) ||
      record.provider_profile_revision < 0)
  ) {
    return null;
  }

  if (
    record.model !== undefined &&
    record.model !== null &&
    (typeof record.model !== "string" ||
      record.model.length === 0 ||
      new TextEncoder().encode(record.model).length > MAX_IDENTIFIER_BYTES)
  ) {
    return null;
  }

  if (
    record.selected_skill_id !== undefined &&
    record.selected_skill_id !== null &&
    (typeof record.selected_skill_id !== "string" ||
      record.selected_skill_id.length === 0 ||
      new TextEncoder().encode(record.selected_skill_id).length > MAX_IDENTIFIER_BYTES)
  ) {
    return null;
  }

  if (
    record.skill_content_revision !== undefined &&
    record.skill_content_revision !== null &&
    (typeof record.skill_content_revision !== "string" ||
      record.skill_content_revision.length === 0 ||
      new TextEncoder().encode(record.skill_content_revision).length > MAX_IDENTIFIER_BYTES)
  ) {
    return null;
  }

  if (
    typeof record.prompt_format_version !== "string" ||
    record.prompt_format_version.length === 0 ||
    new TextEncoder().encode(record.prompt_format_version).length > MAX_FORMAT_VERSION_BYTES
  ) {
    return null;
  }

  if (!Array.isArray(record.section_summaries) || record.section_summaries.length > MAX_SECTIONS_COUNT) {
    return null;
  }

  const section_summaries: PromptSectionSummaryDto[] = [];
  for (const rawSection of record.section_summaries) {
    if (!rawSection || typeof rawSection !== "object" || Array.isArray(rawSection)) {
      return null;
    }
    const secRecord = rawSection as Record<string, unknown>;
    for (const key of Object.keys(secRecord)) {
      if (!ALLOWED_SECTION_KEYS[key]) {
        return null;
      }
    }
    if (typeof secRecord.section !== "string" || !VALID_SECTIONS[secRecord.section]) {
      return null;
    }
    if (typeof secRecord.present !== "boolean") {
      return null;
    }
    if (
      secRecord.estimated_tokens !== undefined &&
      secRecord.estimated_tokens !== null &&
      (typeof secRecord.estimated_tokens !== "number" ||
        !Number.isSafeInteger(secRecord.estimated_tokens) ||
        secRecord.estimated_tokens < 0)
    ) {
      return null;
    }
    if (typeof secRecord.origin !== "string" || (secRecord.origin !== "exact" && secRecord.origin !== "estimate")) {
      return null;
    }
    section_summaries.push({
      section: secRecord.section,
      present: secRecord.present,
      estimated_tokens: (secRecord.estimated_tokens as number | null | undefined) ?? null,
      origin: secRecord.origin,
    });
  }

  return {
    schema_version: record.schema_version as "request_provenance.v1",
    logical_request_id: record.logical_request_id,
    provider_id: record.provider_id,
    provider_profile_id: (record.provider_profile_id as string | null | undefined) ?? null,
    provider_profile_revision: (record.provider_profile_revision as number | null | undefined) ?? null,
    model: (record.model as string | null | undefined) ?? null,
    selected_skill_id: (record.selected_skill_id as string | null | undefined) ?? null,
    skill_content_revision: (record.skill_content_revision as string | null | undefined) ?? null,
    prompt_format_version: record.prompt_format_version,
    section_summaries,
  };
}
