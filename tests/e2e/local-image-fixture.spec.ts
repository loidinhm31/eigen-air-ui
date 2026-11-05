/**
 * Local-image browser proof (Phase 08, slice D).
 *
 * PROOF CLASS: deterministic offline FIXTURE proof. A real Chromium drives the real web app, but the
 * daemon is a Playwright interception (`page.route` for HTTP, `page.routeWebSocket` for WS) that
 * serves wire vectors derived from `test-fixtures/contracts/local-image-v1.json` and a synthetic
 * 256x256 PNG. It is NOT proof of a real model, native/GPU inference, TLS, the hub, or the real
 * Rust image routes (those have their own backend tests). The fixture daemon started by
 * `playwright.config.ts` is never contacted for image traffic: every request to 127.0.0.1:18791 is
 * answered here, and any request this file did not anticipate fails the test.
 *
 * Scope: only what a real browser adds over the vitest suites (decoders, cache, lease driver,
 * components, adapter): real `fetch` + CORS + `Authorization`, real `blob:` URLs that decode as
 * images and are truly revoked, real download events/files, real reload, real storage areas
 * (localStorage, sessionStorage, Cache Storage, cookies, IndexedDB), and a controlled (fake) page
 * clock: `page.clock` drives the lease scenarios and FREEZES time in the hint scenario so that only
 * WS hints can advance job state. Scenarios without `page.clock` run on natural time.
 */
import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
  type WebSocketRoute,
} from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

type Json = Record<string, unknown>;

interface Contract {
  vectors: {
    artifact_refs: { committed_artifact: Json };
    snapshots: { job_snapshot_succeeded: Json };
    templates: { public_list_example: Json };
  };
  http_contract: {
    error_examples: {
      not_found: { error: { code: string } };
      resource_unavailable: { error: { code: string } };
    };
  };
  byte_route_contract: { headers: Record<string, string> };
  gateway_capabilities: {
    generation_version: string;
    phase_06_advertised: Json;
  };
  ws_hints: { events: { job_updated_active: Json; artifact_committed: Json } };
}

const contract = JSON.parse(
  readFileSync(join(__dirname, "../../test-fixtures/contracts/local-image-v1.json"), "utf8")
) as Contract;

const clone = <T>(value: T): T => structuredClone(value);

// --- synthetic identities and canaries -------------------------------------------------------

const DAEMON = "http://127.0.0.1:18791";
const WS_URL = "ws://127.0.0.1:18791/ws";
const SESSION_ID = "e2e-image-session";
const HISTORY_RUN_ID = "run-e2e-history";
const DIRECT_RUN_ID = "run-e2e-direct";
const HISTORY_ARTIFACT_ID = "10000000-0000-4000-8000-0000000000e1";
const HISTORY_JOB_ID = "00000000-0000-4000-8000-0000000000e1";
const DIRECT_JOB_ID = "00000000-0000-4000-8000-0000000000e2";
const DIRECT_ARTIFACT_ID = "10000000-0000-4000-8000-0000000000e2";
const AUTH_STORAGE_KEY = "eigen-air-auth-token";
/** Synthetic bearer; must only ever appear in the Authorization header and the token store key. */
const TOKEN = "CANARY-TOKEN-5e1d9a7c-synthetic";
const PROMPT_CANARY = "CANARY-PROMPT-7f3a";
const NEGATIVE_CANARY = "CANARY-NEGATIVE-2b9d";

// --- synthetic PNG (signature + IHDR + IDAT + IEND, correct CRCs) -----------------------------

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

interface SyntheticPng {
  bytes: Buffer;
  sha256: string;
}

/** 256x256 8-bit grayscale (smallest output size the contract allows); `seed` varies the pixels. */
function buildPng(seed: number): SyntheticPng {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(256, 0);
  ihdr.writeUInt32BE(256, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const rows = Array.from({ length: 256 }, (_, y) =>
    Buffer.concat([Buffer.from([0]), Buffer.alloc(256, (seed + y) & 0xff)])
  );
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

const HISTORY_PNG = buildPng(40);
const DIRECT_PNG = buildPng(150);

// --- wire literals derived from the contract fixture ------------------------------------------

function artifactRef(
  png: SyntheticPng,
  ids: { artifactId: string; jobId: string; runId: string },
  options: { agentToolCallId?: string } = {}
): Json {
  const ref = clone(contract.vectors.artifact_refs.committed_artifact);
  Object.assign(ref, {
    artifact_id: ids.artifactId,
    job_id: ids.jobId,
    session_id: SESSION_ID,
    run_id: ids.runId,
    ordinal: 0,
    width: 256,
    height: 256,
    byte_size: png.bytes.length,
    sha256: png.sha256,
    // Inside the fixture job window (2000..3850): the snapshot decoder rejects artifacts outside it.
    created_at_ms: 1700000003000,
  });
  if (options.agentToolCallId === undefined) delete ref.tool_call_id;
  else ref.tool_call_id = options.agentToolCallId;
  return ref;
}

function directJobSnapshot(
  templateId: string,
  state: "admitted" | "running" | "succeeded",
  revision: number,
  artifacts: Json[]
): Json {
  const snapshot = clone(contract.vectors.snapshots.job_snapshot_succeeded);
  const terminal = state === "succeeded";
  return Object.assign(snapshot, {
    job_id: DIRECT_JOB_ID,
    session_id: SESSION_ID,
    run_id: DIRECT_RUN_ID,
    template_id: templateId,
    state,
    revision,
    requested_count: 1,
    completed_count: artifacts.length,
    effective_quality: "balanced",
    effective_width: 256,
    effective_height: 256,
    terminal_at_ms: terminal ? 1700000003850 : null,
    artifacts,
  });
}

function jobUpdatedHint(state: string, revision: number, completed: number): Json {
  const frame = clone(contract.ws_hints.events.job_updated_active);
  return Object.assign(frame, {
    session_id: SESSION_ID,
    run_id: DIRECT_RUN_ID,
    payload: {
      job_id: DIRECT_JOB_ID,
      session_id: SESSION_ID,
      run_id: DIRECT_RUN_ID,
      state,
      revision,
      requested_count: 1,
      completed_count: completed,
    },
  });
}

function artifactCommittedHint(artifactId: string, revision: number): Json {
  const frame = clone(contract.ws_hints.events.artifact_committed);
  return Object.assign(frame, {
    session_id: SESSION_ID,
    run_id: DIRECT_RUN_ID,
    payload: {
      artifact_id: artifactId,
      job_id: DIRECT_JOB_ID,
      ordinal: 0,
      state: "committed",
      revision,
    },
  });
}

const READERS_ONLY_CAPABILITIES: Json = clone(contract.gateway_capabilities.phase_06_advertised);
const READERS_AND_GENERATION_CAPABILITIES: Json = {
  ...READERS_ONLY_CAPABILITIES,
  local_image: true,
  local_image_version: contract.gateway_capabilities.generation_version,
};

// --- interception fixture daemon ---------------------------------------------------------------

interface RecordedRequest {
  method: string;
  path: string;
  url: string;
  params: Record<string, string>;
  authorization: string | undefined;
  body: unknown;
}

interface DaemonOptions {
  capabilities: Json;
  provider?: "ready" | "failed";
  /** Assistant/user history returned by `chat.history`. */
  history?: Json[];
  /** Committed artifacts served by the listing (the PNG bytes are looked up by artifact id). */
  artifacts?: Json[];
}

type Denial = "ok" | "denied" | "unavailable";

const ALLOWED_QUERY: Record<string, readonly string[]> = {
  listing: ["run_id", "cursor", "limit"],
  job: ["session_id", "run_id"],
  bytes: ["session_id", "run_id", "disposition"],
};

class FakeDaemon {
  capabilities: Json;
  provider: "ready" | "failed";
  history: Json[];
  artifacts: Json[];
  pngs = new Map<string, SyntheticPng>();
  /** Listing endpoint posture: `denied` = uniform 404 `not_found` envelope; `unavailable` = 503. */
  listing: Denial = "ok";
  /** Byte endpoint posture, same meaning. */
  bytes: Denial = "ok";
  job: Json | undefined;
  requests: RecordedRequest[] = [];
  /** Anything the fixture did not anticipate or that breaks the credential/query contract. */
  violations: string[] = [];
  wsMethods: string[] = [];
  wsFrames: string[] = [];
  /**
   * Error bodies actually served for the denial postures: the positive control that the intended
   * error path ran (so a "raw code not rendered" check cannot pass because nothing was denied).
   */
  served: Array<{ surface: "listing" | "bytes"; status: number; code: string }> = [];
  private connectAnswered = false;
  private historyAnswered = false;
  private socket: WebSocketRoute | undefined;

  constructor(options: DaemonOptions) {
    this.capabilities = options.capabilities;
    this.provider = options.provider ?? "ready";
    this.history = options.history ?? [];
    this.artifacts = options.artifacts ?? [];
  }

  async install(page: Page): Promise<void> {
    await page.addInitScript(
      ({ sessionId, token, authKey }) => {
        // Seed only when absent: the init script runs again on reload, and a reload must keep the
        // stored entries exactly as the app left them (otherwise the persistence scan is vacuous).
        if (localStorage.getItem(authKey) !== null) return;
        localStorage.setItem("eigen-air-daemon-url", "http://127.0.0.1:18791");
        localStorage.setItem("eigen-air-session-id", sessionId);
        localStorage.setItem(
          authKey,
          JSON.stringify({ token, retention: "forever", savedAt: Date.now(), expiresAt: null })
        );
        localStorage.removeItem("eigen-air-chat-messages");
      },
      { sessionId: SESSION_ID, token: TOKEN, authKey: AUTH_STORAGE_KEY }
    );
    await page.route(`${DAEMON}/**`, (route) => this.handle(route));
    await page.routeWebSocket(WS_URL, (socket) => this.handleSocket(socket));
  }

  requestsTo(method: string, pathPattern: RegExp): RecordedRequest[] {
    return this.requests.filter((r) => r.method === method && pathPattern.test(r.path));
  }

  byteRequests(disposition: "inline" | "attachment"): RecordedRequest[] {
    return this.requestsTo("GET", /^\/v1\/image-artifacts\//).filter(
      (r) => r.params.disposition === disposition
    );
  }

  /**
   * True once the app can accept a pushed hint: the WS answered `connect` and `chat.history`, and
   * the image history hook activated the session (its first listing GET). The hint subscriber is
   * registered by that same hook, which is not observable on the wire; the listing is.
   */
  private isReadyForHints(): boolean {
    return (
      this.socket !== undefined &&
      this.connectAnswered &&
      this.historyAnswered &&
      this.requestsTo("GET", /\/image-artifacts$/).length > 0
    );
  }

  /** Explicit readiness gate (no sleeps): call before the first `pushHint` of a scenario. */
  async whenReady(): Promise<void> {
    await expect
      .poll(() => this.isReadyForHints(), {
        message: "app never reached connect + chat.history + first listing",
        timeout: 30_000,
      })
      .toBe(true);
  }

  /** Server push of a metadata hint over the intercepted WS. */
  pushHint(frame: Json): void {
    if (!this.socket || !this.isReadyForHints()) {
      throw new Error("fixture WS is not ready for hints: await daemon.whenReady() first");
    }
    this.socket.send(JSON.stringify(frame));
  }

  private respondJson(route: Route, status: number, body: unknown): Promise<void> {
    return route.fulfill({
      status,
      headers: CORS_HEADERS,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  }

  private denial(
    route: Route,
    mode: Denial,
    surface: "listing" | "bytes"
  ): Promise<void> | undefined {
    if (mode === "ok") return undefined;
    const [status, example] =
      mode === "denied"
        ? ([404, contract.http_contract.error_examples.not_found] as const)
        : ([503, contract.http_contract.error_examples.resource_unavailable] as const);
    this.served.push({ surface, status, code: example.error.code });
    return this.respondJson(route, status, example);
  }

  private checkQuery(kind: keyof typeof ALLOWED_QUERY, record: RecordedRequest): void {
    const allowed = ALLOWED_QUERY[kind] ?? [];
    for (const key of Object.keys(record.params)) {
      if (!allowed.includes(key))
        this.violations.push(`unexpected query "${key}" on ${record.path}`);
    }
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    const path = url.pathname;
    const authorization = request.headers()["authorization"];
    let body: unknown;
    const rawBody = request.postData();
    if (rawBody) body = JSON.parse(rawBody) as unknown;
    const record: RecordedRequest = {
      method,
      path,
      url: request.url(),
      params: Object.fromEntries(url.searchParams),
      authorization,
      body,
    };
    this.requests.push(record);

    if (request.url().includes(TOKEN))
      this.violations.push(`credential in URL of ${method} ${path}`);
    const publicRoute = path === "/health" || path === "/readyz" || path === "/v1/skills";
    if (publicRoute && authorization !== undefined) {
      this.violations.push(`Authorization sent to public ${path}`);
    }
    if (!publicRoute && authorization !== `Bearer ${TOKEN}`) {
      this.violations.push(`missing/incorrect bearer on ${method} ${path}`);
      await route.fulfill({ status: 401, headers: CORS_HEADERS, body: "" });
      return;
    }

    if (path === "/health") {
      await this.respondJson(route, 200, { status: "ok", version: "0.2.0" });
    } else if (path === "/readyz") {
      await (this.provider === "ready"
        ? this.respondJson(route, 200, {
            status: "ready",
            retryable: false,
            details: { stages: [] },
          })
        : this.respondJson(route, 503, {
            status: "failed",
            retryable: true,
            details: { stages: [{ name: "model_load", status: "failed", reason: "synthetic" }] },
          }));
    } else if (path === "/v1/config") {
      await this.respondJson(route, 200, {
        capabilities: this.capabilities,
        provider: { type: "fixture", model: "none" },
        memory: { type: "none" },
        server: { host: "127.0.0.1", port: 18791 },
        security: { allow_shell: false, max_tool_calls_per_turn: 1 },
      });
    } else if (path === "/v1/skills") {
      await this.respondJson(route, 200, []);
    } else if (method === "GET" && path === "/v1/user-questions") {
      await this.respondJson(route, 200, {
        schema_version: "user_question.v1",
        questions: [],
        redaction: "metadata_only",
      });
    } else if (method === "GET" && path === "/v1/tool-approvals") {
      await this.respondJson(route, 200, {
        schema_version: "tool_approval.v1",
        approvals: [],
        redaction: "metadata_only",
      });
    } else if (path.startsWith("/v1/inference/")) {
      await this.respondJson(route, 200, []);
    } else if (method === "GET" && path === "/v1/image-templates") {
      await this.respondJson(route, 200, contract.vectors.templates.public_list_example);
    } else if (method === "GET" && path === `/v1/sessions/${SESSION_ID}/image-artifacts`) {
      this.checkQuery("listing", record);
      const denied = this.denial(route, this.listing, "listing");
      if (denied) return denied;
      await this.respondJson(route, 200, {
        schema: "image_artifact_list.v1",
        items: this.artifacts.filter(
          (a) =>
            a.session_id === SESSION_ID &&
            (!record.params.run_id || a.run_id === record.params.run_id)
        ),
        next_cursor: null,
      });
    } else if (method === "POST" && path === "/v1/image-jobs") {
      const templateId =
        typeof body === "object" && body !== null && "template_id" in body
          ? String(body.template_id)
          : "";
      this.job = directJobSnapshot(templateId, "admitted", 1, []);
      await this.respondJson(route, 202, this.job);
    } else if (method === "GET" && path === `/v1/image-jobs/${DIRECT_JOB_ID}`) {
      this.checkQuery("job", record);
      if (!this.job)
        await this.respondJson(route, 404, contract.http_contract.error_examples.not_found);
      else await this.respondJson(route, 200, this.job);
    } else if (method === "GET" && path.startsWith("/v1/image-artifacts/")) {
      this.checkQuery("bytes", record);
      const denied = this.denial(route, this.bytes, "bytes");
      if (denied) return denied;
      const artifactId = decodeURIComponent(path.slice("/v1/image-artifacts/".length));
      const png = this.pngs.get(artifactId);
      const disposition = record.params.disposition;
      if (!png || (disposition !== "inline" && disposition !== "attachment")) {
        await this.respondJson(route, 404, contract.http_contract.error_examples.not_found);
        return;
      }
      const contractHeaders = contract.byte_route_contract.headers;
      await route.fulfill({
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": contractHeaders["Content-Type"] as string,
          "Content-Length": String(png.bytes.length),
          "Cache-Control": contractHeaders["Cache-Control"] as string,
          "X-Content-Type-Options": contractHeaders["X-Content-Type-Options"] as string,
          "Content-Disposition": `${disposition}; filename="${artifactId}.png"`,
        },
        body: png.bytes,
      });
    } else {
      this.violations.push(`unanticipated request ${method} ${path}`);
      await this.respondJson(route, 404, { error: "unmocked" });
    }
  }

  private handleSocket(socket: WebSocketRoute): void {
    this.socket = socket;
    socket.onMessage((raw) => {
      const text = String(raw);
      this.wsFrames.push(text);
      const frame = JSON.parse(text) as { id: string; method: string; params?: { id?: string } };
      this.wsMethods.push(frame.method);
      const respond = (data: unknown) =>
        socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, data }));
      if (frame.method === "connect") {
        respond({ session_id: SESSION_ID, agent: "default", version: "0.2.0" });
        this.connectAnswered = true;
      } else if (frame.method === "sessions.get") {
        if (frame.params?.id === SESSION_ID) {
          respond({
            session: { id: SESSION_ID, channel: "web", status: "active", started_at: 1, updated_at: 1 },
          });
        } else {
          socket.send(
            JSON.stringify({
              type: "res",
              id: frame.id,
              ok: false,
              error: { code: "not_found", message: "Session not found", request_id: frame.id },
            })
          );
        }
      } else if (frame.method === "sessions.list") {
        respond({
          sessions: [
            { id: SESSION_ID, channel: "web", status: "active", started_at: 1, updated_at: 1 },
          ],
          next_cursor: null,
        });
      } else if (frame.method === "chat.history") {
        respond({ messages: this.history });
        this.historyAnswered = true;
      } else {
        this.violations.push(`unanticipated ws method ${frame.method}`);
      }
    });
  }
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, accept",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Length, Content-Disposition",
};

// --- page helpers -------------------------------------------------------------------------------

const HISTORY_MESSAGES: Json[] = [
  { id: "msg-user-1", role: "user", content: "Please draw a lake." },
  {
    id: "msg-assistant-1",
    role: "assistant",
    content: "Here is your lake.",
    run_id: HISTORY_RUN_ID,
  },
];

/** A daemon whose session already holds one committed image bound to the assistant message. */
function daemonWithHistoryImage(options: Omit<DaemonOptions, "artifacts" | "history">): FakeDaemon {
  const daemon = new FakeDaemon({
    ...options,
    history: HISTORY_MESSAGES,
    artifacts: [
      artifactRef(
        HISTORY_PNG,
        { artifactId: HISTORY_ARTIFACT_ID, jobId: HISTORY_JOB_ID, runId: HISTORY_RUN_ID },
        { agentToolCallId: "call_synth_agent_001" }
      ),
    ],
  });
  daemon.pngs.set(HISTORY_ARTIFACT_ID, HISTORY_PNG);
  return daemon;
}

const historyImage = (page: Page): Locator =>
  page.getByRole("group", { name: "Generated images" }).getByRole("img", {
    name: "Generated image 1 of 1",
  });

/** Waits for a decoded `blob:` image of the expected size and returns its object URL. */
async function renderedBlobUrl(image: Locator, side = 256): Promise<string> {
  await expect(image).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() =>
      image.evaluate((el) => {
        const img = el as HTMLImageElement;
        return {
          scheme: img.src.slice(0, 5),
          complete: img.complete,
          width: img.naturalWidth,
          height: img.naturalHeight,
        };
      })
    )
    .toEqual({ scheme: "blob:", complete: true, width: side, height: side });
  return image.evaluate((el) => (el as HTMLImageElement).src);
}

/** True when the browser can still read the object URL (false once it was revoked). */
function blobUrlReadable(page: Page, url: string): Promise<boolean> {
  return page.evaluate(
    (blobUrl) =>
      fetch(blobUrl).then(
        () => true,
        () => false
      ),
    url
  );
}

type StorageArea = "localStorage" | "sessionStorage" | "cookie" | "cacheStorage" | "indexedDB";

interface StorageEntry {
  area: StorageArea;
  key: string;
  value: string;
}

/**
 * Everything the page can persist: localStorage, sessionStorage, `document.cookie`, Cache Storage
 * (cache names, request URLs, response bodies) and IndexedDB (database names + every record of
 * every object store, JSON-stringified). Not covered: service workers, OPFS, HttpOnly cookies
 * (those are scanned separately through the browser context).
 */
function persistedEntries(page: Page): Promise<StorageEntry[]> {
  return page.evaluate(async () => {
    const entries: StorageEntry[] = [];
    for (const [area, storage] of [
      ["localStorage", localStorage],
      ["sessionStorage", sessionStorage],
    ] as const) {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i) as string;
        entries.push({ area, key, value: storage.getItem(key) ?? "" });
      }
    }
    for (const part of document.cookie.split("; ").filter(Boolean)) {
      const at = part.indexOf("=");
      entries.push({ area: "cookie", key: part.slice(0, at), value: part.slice(at + 1) });
    }
    for (const name of await caches.keys()) {
      entries.push({ area: "cacheStorage", key: name, value: "" });
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        entries.push({
          area: "cacheStorage",
          key: `${name} ${request.url}`,
          value: response ? await response.clone().text() : "",
        });
      }
    }
    for (const info of await indexedDB.databases()) {
      const name = info.name ?? "";
      entries.push({ area: "indexedDB", key: name, value: "" });
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const stores = Array.from(db.objectStoreNames);
      if (stores.length > 0) {
        const transaction = db.transaction(stores, "readonly");
        for (const store of stores) {
          const records = await new Promise<unknown[]>((resolve, reject) => {
            const request = transaction.objectStore(store).getAll();
            request.onsuccess = () => resolve(request.result as unknown[]);
            request.onerror = () => reject(request.error);
          });
          let value: string;
          try {
            value = JSON.stringify(records);
          } catch {
            value = String(records);
          }
          entries.push({ area: "indexedDB", key: `${name}/${store}`, value });
        }
      }
      db.close();
    }
    return entries;
  });
}

/** Test-only marker used to prove the scanner reads every store; always removed again. */
const SCAN_PROBE = "e2e-scan-probe";
const SCAN_AREAS: readonly StorageArea[] = [
  "localStorage",
  "sessionStorage",
  "cookie",
  "cacheStorage",
  "indexedDB",
];

function plantScanProbes(page: Page): Promise<void> {
  return page.evaluate(async (probe) => {
    localStorage.setItem(probe, probe);
    sessionStorage.setItem(probe, probe);
    document.cookie = `${probe}=${probe}; path=/`;
    const cache = await caches.open(probe);
    await cache.put(new Request(`/${probe}`), new Response(probe));
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(probe);
      open.onupgradeneeded = () => open.result.createObjectStore("records");
      open.onsuccess = () => {
        const transaction = open.result.transaction("records", "readwrite");
        transaction.objectStore("records").put(probe, "k");
        transaction.oncomplete = () => {
          open.result.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
      open.onerror = () => reject(open.error);
    });
  }, SCAN_PROBE);
}

function removeScanProbes(page: Page): Promise<void> {
  return page.evaluate(async (probe) => {
    localStorage.removeItem(probe);
    sessionStorage.removeItem(probe);
    document.cookie = `${probe}=; path=/; max-age=0`;
    await caches.delete(probe);
    await new Promise<void>((resolve, reject) => {
      const del = indexedDB.deleteDatabase(probe);
      del.onsuccess = () => resolve();
      del.onerror = () => reject(del.error);
      del.onblocked = () => reject(new Error("scan probe database delete blocked"));
    });
  }, SCAN_PROBE);
}

/**
 * Freezes app time: after this resolves no page timer fires unless the test advances the clock.
 * `pauseAt` rejects a target that is already in the past, and real time keeps flowing between
 * reading the page clock and the call, so each attempt re-reads the page clock instead of trusting
 * one stale margin. Only that specific rejection is retried; any other failure surfaces at once.
 */
async function pauseAppClock(page: Page): Promise<void> {
  const maxAttempts = 5;
  for (let attempt = 1; ; attempt += 1) {
    const target = (await page.evaluate(() => Date.now())) + 100;
    try {
      await page.clock.pauseAt(target);
      return;
    } catch (error) {
      const pastTarget = /past/i.test(String(error));
      if (!pastTarget || attempt === maxAttempts) throw error;
    }
  }
}

/** Fixture hygiene shared by every scenario: nothing unanticipated, no credential misuse. */
function expectCleanFixture(daemon: FakeDaemon): void {
  expect(daemon.violations).toEqual([]);
}

const NOT_FOUND_CODE = contract.http_contract.error_examples.not_found.error.code;
const UNAVAILABLE_CODE = contract.http_contract.error_examples.resource_unavailable.error.code;
const ASSISTANT_TEXT = "Here is your lake.";

/**
 * Fixture-served error bodies (raw codes) must never reach the rendered page. The scan is proven to
 * read the page by the fixture's own history text; callers separately prove the denial was served.
 */
async function expectNoRawErrorCodes(page: Page): Promise<void> {
  const text = (await page.locator("body").textContent()) ?? "";
  expect(text, "positive control: scan reads the rendered page").toContain(ASSISTANT_TEXT);
  for (const code of [NOT_FOUND_CODE, UNAVAILABLE_CODE]) {
    expect(text, `raw fixture error code "${code}" rendered`).not.toContain(code);
  }
}

// --- scenarios ---------------------------------------------------------------------------------

test.describe("local image browser fixture proof", () => {
  test("readers advertised without generation: authenticated preview, fresh download, no generate action", async ({
    page,
  }) => {
    const daemon = daemonWithHistoryImage({ capabilities: READERS_ONLY_CAPABILITIES });
    await daemon.install(page);
    await page.goto("/");

    const image = historyImage(page);
    const blobUrl = await renderedBlobUrl(image);
    expect(blobUrl.startsWith("blob:")).toBe(true);
    // Positive control for the "composer disabled" scenario below: with a ready provider it is enabled.
    await expect(page.getByRole("textbox")).toBeEnabled();
    // Preview bytes follow the assistant message that owns the run.
    const assistant = await page.getByText("Here is your lake.").boundingBox();
    const picture = await image.boundingBox();
    expect((assistant?.y ?? Number.POSITIVE_INFINITY) < (picture?.y ?? 0)).toBe(true);

    // Preview byte GET: bearer in the header only, scope in the query, never a credential in the URL.
    const preview = daemon.byteRequests("inline");
    expect(preview.length).toBeGreaterThanOrEqual(1);
    for (const request of preview) {
      expect(request.authorization).toBe(`Bearer ${TOKEN}`);
      expect(request.path).toBe(`/v1/image-artifacts/${HISTORY_ARTIFACT_ID}`);
      expect(request.params).toEqual({
        session_id: SESSION_ID,
        run_id: HISTORY_RUN_ID,
        disposition: "inline",
      });
      expect(request.url).not.toContain(TOKEN);
    }

    // Readers on, generation not advertised: the history is there, the action never is.
    await expect(page.getByRole("button", { name: "Generate image" })).toHaveCount(0);
    expect(daemon.requestsTo("GET", /^\/v1\/image-templates$/)).toEqual([]);
    expect(daemon.requestsTo("POST", /^\/v1\/image-jobs/)).toEqual([]);

    // Download = a NEW attachment GET (never the cached preview) that produces a real file.
    expect(daemon.byteRequests("attachment")).toEqual([]);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download image 1 of 1" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`${HISTORY_ARTIFACT_ID}.png`);
    const savedPath = await download.path();
    expect(createHash("sha256").update(readFileSync(savedPath)).digest("hex")).toBe(
      HISTORY_PNG.sha256
    );
    const attachment = daemon.byteRequests("attachment");
    expect(attachment).toHaveLength(1);
    expect(attachment[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(attachment[0]?.url).not.toContain(TOKEN);
    expect(attachment[0]?.params.disposition).toBe("attachment");
    // The preview is still displayed after the download.
    expect(await blobUrlReadable(page, blobUrl)).toBe(true);

    expectCleanFixture(daemon);
  });

  test("generation advertised: direct template submits without chat inference; job state and the image advance only on WS hints under a frozen clock", async ({
    page,
  }) => {
    const daemon = new FakeDaemon({
      capabilities: READERS_AND_GENERATION_CAPABILITIES,
      history: HISTORY_MESSAGES.slice(0, 1),
    });
    await daemon.install(page);
    await page.clock.install(); // before goto: every app timer (incl. the job poll) is under test control
    await page.goto("/");
    await page.evaluate(() => {
      Reflect.set(window, "__noReloadMarker", 1);
    });

    const trigger = page.getByRole("button", { name: "Generate image", exact: true });
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    await trigger.click();
    const panel = page.getByRole("region", { name: "Generate image" });
    const template = panel.getByLabel("Template", { exact: true });
    await expect(template).toBeVisible({ timeout: 30_000 });
    await template.selectOption({ label: "Product Photograph" });
    await panel.getByLabel("Prompt", { exact: true }).fill(`${PROMPT_CANARY} a lake at dawn`);
    await panel.getByLabel("Negative prompt (optional)").fill(NEGATIVE_CANARY);
    await panel.getByLabel("Quality").selectOption("balanced"); // template default is "high"
    await panel.getByLabel("Seed (optional)").fill("42");

    // Freeze app time BEFORE the job exists. From here no app timer fires (notably the 2 s job poll,
    // IMAGE_JOB_POLL_MS) unless this test advances the clock, so only WS hints can drive job state.
    // Connection setup is already done; the intended hint-triggered refetch needs no timer.
    await pauseAppClock(page);

    const generate = panel.getByRole("button", { name: "Generate", exact: true });
    await generate.click();

    // Direct-template wire shape: no tool_call_id/provider/action/origin/run_id from the client.
    await expect.poll(() => daemon.requestsTo("POST", /^\/v1\/image-jobs$/).length).toBe(1);
    const create = daemon.requestsTo("POST", /^\/v1\/image-jobs$/)[0] as RecordedRequest;
    expect(create.authorization).toBe(`Bearer ${TOKEN}`);
    expect(create.params).toEqual({});
    expect(create.body).toEqual({
      template_id: "product-photograph",
      prompt: `${PROMPT_CANARY} a lake at dawn`,
      negative_prompt: NEGATIVE_CANARY,
      settings: { quality: "balanced", seed: 42 },
      session_id: SESSION_ID,
    });

    const jobGets = () =>
      daemon.requestsTo("GET", new RegExp(`^/v1/image-jobs/${DIRECT_JOB_ID}$`)).length;
    const status = panel.locator("[data-image-action-status]");
    // No structural hook exposes job progress: match only the fixture-derived count, not the prose.
    await expect(status).toHaveText(/\b0 of 1\b/);
    const queuedText = await status.innerText();
    await expect(generate).toBeDisabled(); // job active: a second submit is blocked
    const generated = page.getByRole("img", { name: /^Generated image/ });
    await expect(generated).toHaveCount(0);

    // NEGATIVE CONTROL: the server-side job changes but NO hint is pushed and the clock stays
    // frozen. Nothing may refetch it, so the UI must not move (a poll-driven UI would).
    daemon.job = directJobSnapshot("product-photograph", "running", 3, []);
    // Barrier: a public round trip through the same interception path. Requests the page issued
    // earlier were routed first, so any unwanted job refetch is recorded before this returns.
    expect(await page.evaluate((url) => fetch(url).then((r) => r.ok), `${DAEMON}/health`)).toBe(
      true
    );
    expect(jobGets(), "job refetched without a hint while time is frozen").toBe(0);
    await expect(status).toHaveText(queuedText);
    await expect(generate).toBeDisabled();

    // Now the hint (it carries no data): exactly one authoritative refetch, UI moves on.
    await daemon.whenReady();
    daemon.pushHint(jobUpdatedHint("running", 3, 0));
    await expect.poll(jobGets).toBe(1);
    await expect(status).not.toHaveText(queuedText);
    await expect(status).toHaveText(/\b0 of 1\b/);
    await expect(generate).toBeDisabled();
    // Refetches are spaced by 1 s of app time: advance exactly that, still below the 2 s poll
    // armed at submit, so the poll cannot have fired.
    await page.clock.runFor(1000);
    expect(jobGets()).toBe(1);

    // Commit: listing + job now include the artifact; hints trigger the refetches.
    const artifact = artifactRef(DIRECT_PNG, {
      artifactId: DIRECT_ARTIFACT_ID,
      jobId: DIRECT_JOB_ID,
      runId: DIRECT_RUN_ID,
    });
    daemon.pngs.set(DIRECT_ARTIFACT_ID, DIRECT_PNG);
    daemon.artifacts = [artifact];
    daemon.job = directJobSnapshot("product-photograph", "succeeded", 5, [artifact]);
    daemon.pushHint(jobUpdatedHint("succeeded", 5, 1));
    daemon.pushHint(artifactCommittedHint(DIRECT_ARTIFACT_ID, 1));

    await expect.poll(jobGets).toBe(2);
    await expect(status).toHaveText(/\b1 of 1\b/);
    await expect(generate).toBeEnabled(); // terminal: the action is available again
    const committed = page
      .getByRole("group", { name: /^Images from run / })
      .getByRole("img", { name: "Generated image 1 of 1" });
    // Listing refetches are spaced by the store (1 s of app time): advance in 1 s steps until the
    // committed image is listed. The job is terminal, so no job poll can be pending.
    await expect
      .poll(
        async () => {
          if ((await committed.count()) === 0) await page.clock.runFor(1000);
          return committed.count();
        },
        { timeout: 30_000 }
      )
      .toBe(1);
    await renderedBlobUrl(committed);
    // One refetch per job hint, never a poll.
    expect(jobGets()).toBe(2);
    expect(await page.evaluate(() => Reflect.get(window, "__noReloadMarker"))).toBe(1);

    // LLM-free: the only daemon traffic for this action is REST. Positive control first.
    expect(daemon.wsMethods).toContain("connect");
    expect(daemon.wsMethods).toContain("chat.history");
    expect(
      daemon.wsMethods.filter((method) => method.startsWith("chat.") && method !== "chat.history")
    ).toEqual([]);

    // Private prompts: sent exactly once (the REST body, asserted above), nowhere else.
    for (const entry of await persistedEntries(page)) {
      expect(entry.value, `${entry.area}:${entry.key}`).not.toContain(PROMPT_CANARY);
      expect(entry.value, `${entry.area}:${entry.key}`).not.toContain(NEGATIVE_CANARY);
    }
    for (const frame of daemon.wsFrames) {
      expect(frame).not.toContain(PROMPT_CANARY);
      expect(frame).not.toContain(NEGATIVE_CANARY);
    }
    for (const request of daemon.requests) {
      expect(request.url).not.toContain(PROMPT_CANARY);
    }
    await expect(page.getByText(PROMPT_CANARY)).toHaveCount(0);

    expectCleanFixture(daemon);
  });

  test("reload re-reads the listing and bytes; localStorage, sessionStorage, Cache Storage, cookies and IndexedDB hold no image data and the bearer only under the UI's token key", async ({
    page,
  }) => {
    const daemon = daemonWithHistoryImage({ capabilities: READERS_ONLY_CAPABILITIES });
    await daemon.install(page);
    await page.goto("/");
    const firstUrl = await renderedBlobUrl(historyImage(page));
    const readAuth = () => page.evaluate((key) => localStorage.getItem(key), AUTH_STORAGE_KEY);
    const authBefore = await readAuth();
    expect(authBefore, "token seeded under the UI's auth key").toContain(TOKEN);
    const listingsBefore = daemon.requestsTo("GET", /\/image-artifacts$/).length;
    const bytesBefore = daemon.byteRequests("inline").length;

    await page.reload();
    const secondUrl = await renderedBlobUrl(historyImage(page));
    // Durable history = the daemon listing; the previous page's object URL died with it.
    expect(secondUrl).not.toBe(firstUrl);
    expect(daemon.requestsTo("GET", /\/image-artifacts$/).length).toBeGreaterThan(listingsBefore);
    expect(daemon.byteRequests("inline").length).toBeGreaterThan(bytesBefore);

    // The init script only seeds when absent, so a byte-identical entry after reload proves the
    // stored value survived the reload itself (a re-seed would stamp a new `savedAt`).
    expect(await readAuth()).toBe(authBefore);

    const entries = await persistedEntries(page);
    // Positive control: the scan reads real entries (the UI's own localStorage keys).
    expect(entries.filter((entry) => entry.area === "localStorage").length).toBeGreaterThan(0);
    for (const entry of entries) {
      const where = `${entry.area}:${entry.key}`;
      const text = `${entry.key}\n${entry.value}`;
      expect(text, where).not.toContain("blob:");
      expect(text, where).not.toContain("data:image");
      expect(text, where).not.toContain("iVBORw0KGgo"); // base64 PNG signature
      expect(text, where).not.toContain(HISTORY_PNG.sha256);
      expect(text, where).not.toContain(HISTORY_ARTIFACT_ID);
    }
    // The bearer lives only in the token store the UI owns; never copied anywhere else.
    expect(
      entries
        .filter((entry) => `${entry.key}\n${entry.value}`.includes(TOKEN))
        .map((entry) => `${entry.area}:${entry.key}`)
    ).toEqual([`localStorage:${AUTH_STORAGE_KEY}`]);
    // HttpOnly cookies are invisible to document.cookie: read them through the browser context.
    expect(JSON.stringify(await page.context().cookies())).not.toContain(TOKEN);

    // Proof the scanner reads every store: plant a test-only probe in each, expect to find it
    // (with its content for Cache Storage / IndexedDB), then remove it and expect it gone.
    await plantScanProbes(page);
    const probed = await persistedEntries(page);
    for (const area of SCAN_AREAS) {
      expect(
        probed.some(
          (entry) => entry.area === area && `${entry.key}\n${entry.value}`.includes(SCAN_PROBE)
        ),
        `scanner did not read the probe in ${area}`
      ).toBe(true);
    }
    expect(probed.some((e) => e.area === "cacheStorage" && e.value === SCAN_PROBE)).toBe(true);
    expect(probed.some((e) => e.area === "indexedDB" && e.value.includes(SCAN_PROBE))).toBe(true);
    await removeScanProbes(page);
    expect(
      (await persistedEntries(page)).filter((entry) =>
        `${entry.key}\n${entry.value}`.includes(SCAN_PROBE)
      )
    ).toEqual([]);

    expectCleanFixture(daemon);
  });

  test.describe("server-side revocation under the foreground lease clock", () => {
    test("uniform listing denial within one metadata tick revokes the preview, recovery needs a fresh listing", async ({
      page,
    }) => {
      const daemon = daemonWithHistoryImage({ capabilities: READERS_ONLY_CAPABILITIES });
      await daemon.install(page);
      await page.clock.install(); // before goto: every app timer is under test control
      await page.goto("/");
      const oldUrl = await renderedBlobUrl(historyImage(page));
      expect(await blobUrlReadable(page, oldUrl)).toBe(true);

      daemon.listing = "denied"; // same session and token; only the server's answer changed
      daemon.bytes = "denied";
      await page.clock.runFor(15_000); // <= 15 s metadata renewal tick

      await expect(historyImage(page)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Download image/ })).toHaveCount(0);
      // The failure notice offers recovery (structural; its copy is deliberately not asserted).
      await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
      // Positive control: the uniform listing denial really was served to the app.
      expect(
        daemon.served.filter(
          (s) => s.surface === "listing" && s.status === 404 && s.code === NOT_FOUND_CODE
        ).length
      ).toBeGreaterThan(0);
      await expectNoRawErrorCodes(page);
      // Revoked for real: the browser no longer resolves the old object URL.
      expect(await blobUrlReadable(page, oldUrl)).toBe(false);

      // Access restored server-side: only a fresh listing + fresh bytes bring a NEW URL back.
      daemon.listing = "ok";
      daemon.bytes = "ok";
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      const newUrl = await renderedBlobUrl(historyImage(page));
      expect(newUrl).not.toBe(oldUrl);
      expect(await blobUrlReadable(page, oldUrl)).toBe(false);

      expectCleanFixture(daemon);
    });

    test("failed renewals never extend the 30s preview lease: the old blob is revoked at expiry", async ({
      page,
    }) => {
      const daemon = daemonWithHistoryImage({ capabilities: READERS_ONLY_CAPABILITIES });
      await daemon.install(page);
      await page.clock.install();
      await page.goto("/");
      const oldUrl = await renderedBlobUrl(historyImage(page));
      const bytesBefore = daemon.byteRequests("inline").length;

      daemon.listing = "unavailable"; // transient: the daemon cannot answer renewals
      await page.clock.runFor(15_000);
      // Renewal failure offers recovery (structural) while the authorized preview stays displayed.
      await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
      // Positive control: the transient 503 really was served.
      expect(
        daemon.served.filter(
          (s) => s.surface === "listing" && s.status === 503 && s.code === UNAVAILABLE_CODE
        ).length
      ).toBeGreaterThan(0);
      // Still inside the original lease: the already-authorized preview stays displayed.
      expect(await blobUrlReadable(page, oldUrl)).toBe(true);
      await expect(historyImage(page)).toBeVisible();
      await expectNoRawErrorCodes(page);

      await page.clock.runFor(15_000); // lease anchored at the last SUCCESSFUL listing is now spent
      await expect(historyImage(page)).toHaveCount(0);
      expect(await blobUrlReadable(page, oldUrl)).toBe(false);
      // The slot offers a manual Reload instead of the picture (structural).
      await expect(page.getByRole("button", { name: "Reload", exact: true })).toBeVisible();
      await expectNoRawErrorCodes(page);
      // Nothing re-fetched bytes on the strength of the failed renewals.
      expect(daemon.byteRequests("inline")).toHaveLength(bytesBefore);

      expectCleanFixture(daemon);
    });

    test("download after server-side revocation saves nothing and shows a fixed notice", async ({
      page,
    }) => {
      const daemon = daemonWithHistoryImage({ capabilities: READERS_ONLY_CAPABILITIES });
      await daemon.install(page);
      await page.goto("/");
      const oldUrl = await renderedBlobUrl(historyImage(page));
      let downloads = 0;
      page.on("download", () => {
        downloads += 1;
      });

      const downloadAlert = page.locator("figcaption").getByRole("alert");
      await expect(downloadAlert).toHaveCount(0); // no failure shown before the attempt
      daemon.bytes = "denied";
      await page.getByRole("button", { name: "Download image 1 of 1" }).click();
      await expect(downloadAlert).toBeVisible(); // fixed notice next to the Download button
      expect(
        daemon.served.filter(
          (s) => s.surface === "bytes" && s.status === 404 && s.code === NOT_FOUND_CODE
        ).length
      ).toBeGreaterThan(0); // positive control: the denial was really served for the fresh GET
      expect(downloads).toBe(0);
      expect(daemon.byteRequests("attachment")).toHaveLength(1);
      // A uniform denial of the fresh GET also drops the cached preview of that run.
      await expect(historyImage(page)).toHaveCount(0);
      expect(await blobUrlReadable(page, oldUrl)).toBe(false);
      await expectNoRawErrorCodes(page);

      expectCleanFixture(daemon);
    });
  });

  test("history and direct action stay available while the chat provider is not ready", async ({
    page,
  }) => {
    const daemon = daemonWithHistoryImage({
      capabilities: READERS_AND_GENERATION_CAPABILITIES,
      provider: "failed",
    });
    await daemon.install(page);
    await page.goto("/");

    await renderedBlobUrl(historyImage(page));
    // Structural readiness-failure signals: composer disabled + the banner's own Retry action.
    // Positive control: the failing /readyz answer was requested (provider is "failed" here).
    await expect.poll(() => daemon.requestsTo("GET", /^\/readyz$/).length).toBeGreaterThan(0);
    await expect(page.getByRole("textbox")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();

    const trigger = page.getByRole("button", { name: "Generate image", exact: true });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const panel = page.getByRole("region", { name: "Generate image" });
    await expect(panel.getByLabel("Template", { exact: true })).toBeVisible({ timeout: 30_000 });
    await panel.getByLabel("Prompt", { exact: true }).fill("a quiet harbour");
    await panel.getByRole("button", { name: "Generate", exact: true }).click();

    await expect.poll(() => daemon.requestsTo("POST", /^\/v1\/image-jobs$/).length).toBe(1);
    // Progress count only (no structural hook): fixture-derived, surrounding prose not asserted.
    await expect(panel.locator("[data-image-action-status]")).toHaveText(/\b0 of 1\b/);
    expect(daemon.wsMethods.filter((method) => method === "chat.send")).toEqual([]);

    expectCleanFixture(daemon);
  });
});
