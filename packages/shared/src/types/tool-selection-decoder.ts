import type { ToolSelectionDetailDto, ToolSelectionDto } from "./api.js";

export const TOOL_SELECTION_SCHEMA = "tool_selection.v1";
export const MAX_TOOL_SELECTION_BYTES = 16 * 1024;
export const MAX_TOOL_SELECTION_DETAILS = 32;
export const MAX_TOOL_SELECTION_DETAIL_BYTES = 4 * 1024;
export const MAX_CAP_SOURCE_BYTES = 64;
export const MAX_ORDER_HASH_BYTES = 64;
export const MAX_CANONICAL_NAME_BYTES = 128;
export const MAX_REASON_CODE_BYTES = 64;

const ALLOWED_KEYS: Record<string, true> = {
  schema_version: true,
  effective_cap: true,
  cap_source: true,
  checked_count: true,
  eligible_count: true,
  selected_count: true,
  rejected_count: true,
  required_count: true,
  context_count: true,
  optional_count: true,
  global_count: true,
  selected_total: true,
  selected_omitted: true,
  rejected_total: true,
  rejected_omitted: true,
  reason_counts: true,
  order_hash: true,
  selected_tools: true,
  rejected_tools: true,
  name_details_redacted: true,
};

const ALLOWED_DETAIL_KEYS: Record<string, true> = {
  canonical_name: true,
  reason_code: true,
  reason: true,
};

function isValidReasonCode(code: unknown): code is string {
  if (typeof code !== "string" || code.length === 0 || code.length > MAX_REASON_CODE_BYTES) {
    return false;
  }
  return /^[a-z0-9_]+$/.test(code);
}

function decodeToolDetail(item: unknown): ToolSelectionDetailDto | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  const record = item as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_DETAIL_KEYS[key]) {
      return null;
    }
  }
  const canonicalName = record.canonical_name;
  if (
    typeof canonicalName !== "string" ||
    canonicalName.length === 0 ||
    new TextEncoder().encode(canonicalName).length > MAX_CANONICAL_NAME_BYTES
  ) {
    return null;
  }
  const reasonCode = record.reason_code ?? record.reason;
  if (!isValidReasonCode(reasonCode)) {
    return null;
  }
  return {
    canonical_name: canonicalName,
    reason_code: reasonCode,
    ...(typeof record.reason === "string" ? { reason: record.reason } : {}),
  };
}

function decodeToolDetailList(list: unknown): ToolSelectionDetailDto[] | null {
  if (!Array.isArray(list)) {
    return null;
  }
  if (list.length > MAX_TOOL_SELECTION_DETAILS) {
    return null;
  }
  try {
    const encodedLength = new TextEncoder().encode(JSON.stringify(list)).length;
    if (encodedLength > MAX_TOOL_SELECTION_DETAIL_BYTES) {
      return null;
    }
  } catch {
    return null;
  }
  const details: ToolSelectionDetailDto[] = [];
  for (const item of list) {
    const detail = decodeToolDetail(item);
    if (!detail) {
      return null;
    }
    details.push(detail);
  }
  return details;
}

export function decodeToolSelection(value: unknown): ToolSelectionDto | null {
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
    if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_TOOL_SELECTION_BYTES) {
      return null;
    }
  } catch {
    return null;
  }

  if (record.schema_version !== TOOL_SELECTION_SCHEMA) {
    return null;
  }

  let effectiveCap: number | null | undefined;
  if (record.effective_cap !== undefined && record.effective_cap !== null) {
    if (
      typeof record.effective_cap !== "number" ||
      !Number.isSafeInteger(record.effective_cap) ||
      record.effective_cap < 0
    ) {
      return null;
    }
    effectiveCap = record.effective_cap;
  } else if (record.effective_cap === null) {
    effectiveCap = null;
  }

  let capSource: string | undefined;
  if (record.cap_source !== undefined) {
    if (
      typeof record.cap_source !== "string" ||
      record.cap_source.length === 0 ||
      new TextEncoder().encode(record.cap_source).length > MAX_CAP_SOURCE_BYTES
    ) {
      return null;
    }
    capSource = record.cap_source;
  }

  const parseCount = (key: string): number | undefined => {
    const v = record[key];
    if (v === undefined) return undefined;
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
      return null as unknown as undefined;
    }
    return v;
  };

  const countKeys = [
    "checked_count",
    "eligible_count",
    "selected_count",
    "rejected_count",
    "required_count",
    "context_count",
    "optional_count",
    "global_count",
    "selected_total",
    "selected_omitted",
    "rejected_total",
    "rejected_omitted",
  ] as const;

  const counts: Partial<Record<(typeof countKeys)[number], number>> = {};
  for (const k of countKeys) {
    if (record[k] !== undefined) {
      const parsed = parseCount(k);
      if (parsed === (null as unknown as undefined)) {
        return null;
      }
      counts[k] = parsed;
    }
  }

  let reasonCounts: Record<string, number> | undefined;
  if (record.reason_counts !== undefined) {
    if (
      !record.reason_counts ||
      typeof record.reason_counts !== "object" ||
      Array.isArray(record.reason_counts)
    ) {
      return null;
    }
    reasonCounts = {};
    for (const [k, v] of Object.entries(record.reason_counts)) {
      if (!isValidReasonCode(k) || typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
        return null;
      }
      reasonCounts[k] = v;
    }
  }

  let orderHash: string | undefined;
  if (record.order_hash !== undefined) {
    if (
      typeof record.order_hash !== "string" ||
      record.order_hash.length === 0 ||
      record.order_hash.length > MAX_ORDER_HASH_BYTES ||
      !/^[a-fA-F0-9]+$/.test(record.order_hash)
    ) {
      return null;
    }
    orderHash = record.order_hash;
  }

  let selectedTools: ToolSelectionDetailDto[] | undefined;
  if (record.selected_tools !== undefined) {
    const decoded = decodeToolDetailList(record.selected_tools);
    if (decoded === null) {
      return null;
    }
    selectedTools = decoded;
  }

  let rejectedTools: ToolSelectionDetailDto[] | undefined;
  if (record.rejected_tools !== undefined) {
    const decoded = decodeToolDetailList(record.rejected_tools);
    if (decoded === null) {
      return null;
    }
    rejectedTools = decoded;
  }

  let nameDetailsRedacted: boolean | undefined;
  if (record.name_details_redacted !== undefined) {
    if (typeof record.name_details_redacted !== "boolean") {
      return null;
    }
    nameDetailsRedacted = record.name_details_redacted;
  }

  return {
    schema_version: TOOL_SELECTION_SCHEMA,
    effective_cap: effectiveCap,
    cap_source: capSource,
    ...counts,
    reason_counts: reasonCounts,
    order_hash: orderHash,
    selected_tools: selectedTools,
    rejected_tools: rejectedTools,
    name_details_redacted: nameDetailsRedacted,
  };
}
