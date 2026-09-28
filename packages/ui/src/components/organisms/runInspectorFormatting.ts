export function displayId(value?: string | null): string {
  return value || "Not reported";
}

export function formatTimestamp(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "Not reported";
  return new Date(ms).toLocaleString();
}

export function runDurationText(
  startedAtMs?: number | null,
  completedAtMs?: number | null,
  updatedAtMs?: number | null,
): string {
  if (startedAtMs == null || !Number.isFinite(startedAtMs) || startedAtMs <= 0) {
    return "unavailable";
  }
  if (completedAtMs != null) {
    if (!Number.isFinite(completedAtMs) || completedAtMs < startedAtMs) {
      return "unavailable (invalid timestamp range)";
    }
    return `${completedAtMs - startedAtMs} ms`;
  }
  if (updatedAtMs != null && Number.isFinite(updatedAtMs) && updatedAtMs >= startedAtMs) {
    return `${updatedAtMs - startedAtMs} ms (ongoing elapsed)`;
  }
  return "unavailable";
}

export function toolDurationText(
  startedAtMs?: number | null,
  completedAtMs?: number | null,
  status?: string,
): string {
  if (startedAtMs == null || !Number.isFinite(startedAtMs) || startedAtMs <= 0) {
    return "unavailable";
  }
  if (completedAtMs != null) {
    if (!Number.isFinite(completedAtMs) || completedAtMs < startedAtMs) {
      return "unavailable (invalid range)";
    }
    return `${completedAtMs - startedAtMs} ms`;
  }
  if (status === "running" || status === "requested") {
    return "ongoing";
  }
  return "unavailable";
}
