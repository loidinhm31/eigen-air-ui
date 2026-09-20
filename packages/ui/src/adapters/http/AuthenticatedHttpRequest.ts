export type RunCapabilities = ReadonlySet<"run:read:debug" | "run:export" | "run:delete">;

/** Authenticated host state context used across adapters in memory. */
export interface AccessContext {
  capabilities?: RunCapabilities;
  authToken?: string;
  /** Changes when the authenticated principal or role set changes. */
  identityKey?: string;
  /** Monotonic in-memory fence for token/principal rotation. */
  accessRevision?: number;
}

export type AccessSource = AccessContext | (() => AccessContext | undefined) | undefined;

export type HttpRequestMode = "public" | "protected";

/**
 * Access-aware HTTP request helper returning a raw Response.
 * - Extracts authToken from the access source at request time.
 * - Enforces `credentials: "omit"`.
 * - In "protected" mode, attaches `Authorization: Bearer <token>` if token is non-empty.
 * - In "public" mode or when token is empty, ensures no Authorization header is sent.
 * - Preserves method, body, cache, signal, Accept, Content-Type, and all other headers.
 * - Strips any caller-provided Authorization header so the access source is sole authority.
 * - Never catches or wraps network errors with token or URL details.
 */
export async function fetchWithAccess(
  baseUrl: string,
  path: string,
  access: AccessSource,
  init?: RequestInit,
  mode: HttpRequestMode = "protected"
): Promise<Response> {
  const currentAccess = typeof access === "function" ? access() : access;
  const token = currentAccess?.authToken;

  const headers = new Headers(init?.headers);
  headers.delete("Authorization");

  if (mode === "protected" && typeof token === "string" && token.length > 0) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;

  return fetch(`${cleanBase}${cleanPath}`, {
    ...init,
    credentials: "omit",
    headers,
  });
}
