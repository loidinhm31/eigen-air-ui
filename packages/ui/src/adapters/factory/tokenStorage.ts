import { STORAGE_KEYS, type TokenRetention, type StoredTokenPayload } from "@nonclaw-ui/shared/constants";

const RETENTION_MS_MAP: Record<Exclude<TokenRetention, "session" | "forever">, number> = {
  "1h": 60 * 60 * 1_000,
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
};

export function computeExpiresAt(retention: TokenRetention, now: number = Date.now()): number | null {
  if (retention === "session" || retention === "forever") {
    return null;
  }
  return now + (RETENTION_MS_MAP[retention] ?? RETENTION_MS_MAP["7d"]);
}

export function saveStoredAuthToken(token: string, retention: TokenRetention = "7d"): void {
  if (typeof window === "undefined") return;

  const trimmed = token.trim();
  if (!trimmed) {
    clearStoredAuthToken();
    return;
  }

  const now = Date.now();
  const payload: StoredTokenPayload = {
    token: trimmed,
    retention,
    savedAt: now,
    expiresAt: computeExpiresAt(retention, now),
  };

  const serialized = JSON.stringify(payload);

  if (retention === "session") {
    try {
      sessionStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, serialized);
      localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
    } catch {}
  } else {
    try {
      localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, serialized);
      sessionStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
    } catch {}
  }
}

export function getStoredAuthToken(now: number = Date.now()): string | undefined {
  if (typeof window === "undefined") return undefined;

  // Check sessionStorage first
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    if (raw) {
      const payload = JSON.parse(raw) as StoredTokenPayload;
      if (payload.token) return payload.token;
    }
  } catch {
    // Fall back to localStorage
  }

  // Check localStorage
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    if (raw) {
      const payload = JSON.parse(raw) as StoredTokenPayload;
      if (payload.expiresAt && payload.expiresAt <= now) {
        localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
        return undefined;
      }
      return payload.token;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function getStoredTokenRetention(): TokenRetention {
  if (typeof window === "undefined") return "7d";
  try {
    const rawSession = sessionStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    if (rawSession) {
      const parsed = JSON.parse(rawSession) as StoredTokenPayload;
      if (parsed.retention) return parsed.retention;
    }
  } catch {}
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredTokenPayload;
      if (parsed.retention) return parsed.retention;
    }
  } catch {}
  return "7d";
}

export function clearStoredAuthToken(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
  } catch {}
  try {
    localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
  } catch {}
}
