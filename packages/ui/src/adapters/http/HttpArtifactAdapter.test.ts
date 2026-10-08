import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactAdapterError } from "../factory/interfaces/IArtifactAdapter.js";
import { ARTIFACT_MAX_LIST_PAGES, HttpArtifactAdapter } from "./HttpArtifactAdapter.js";
import {
  BASE_URL,
  PNG_256,
  TOKEN,
  PNG_256_SHA256,
  committedArtifact,
  directSnapshot,
  runningSnapshot,
  templateList,
  json,
  pngResponse,
  probedStream,
} from "./artifact-test-support.js";

const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
const adapter = new HttpArtifactAdapter(BASE_URL, () => ({ authToken: TOKEN }));

const jobSelector = {
  jobId: runningSnapshot.job_id as string,
  sessionId: "session-synth-001",
  runId: "run-synth-001",
};
const bytesRequest = {
  artifactId: "10000000-0000-4000-8000-000000000001",
  sessionId: "session-synth-001",
  runId: "run-synth-001",
  byteSize: PNG_256.byteLength,
  sha256: PNG_256_SHA256,
  width: 256,
  height: 256,
};

function artifact(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...committedArtifact, artifact_id: id, ...overrides };
}

function page(items: Array<Record<string, unknown>>, next: string | null): Response {
  return json({ schema: "image_artifact_list.v1", items, next_cursor: next });
}

function lastCall(): { url: URL; raw: string; init: RequestInit; headers: Headers } {
  const [raw, init] = fetchMock.mock.calls.at(-1) ?? [];
  if (!raw || !init) throw new Error("fetch not called");
  return { url: new URL(raw), raw, init, headers: new Headers(init.headers) };
}

async function failureOf(promise: Promise<unknown>): Promise<ArtifactAdapterError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ArtifactAdapterError);
    return error as ArtifactAdapterError;
  }
  throw new Error("expected rejection");
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HttpArtifactAdapter requests", () => {
  it("lists templates with header auth only, omit credentials, no-store", async () => {
    fetchMock.mockResolvedValue(json(templateList));
    const result = await adapter.listTemplates();
    expect(result.schema).toBe("image_template_list.v1");
    const { url, raw, init, headers } = lastCall();
    expect(url.pathname).toBe("/v1/image-templates");
    expect(raw).not.toContain(TOKEN);
    expect(headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("Accept")).toBe("application/json");
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-store");
    expect(init.method).toBe("GET");
  });

  it("reads the access token per request", async () => {
    let token = "first";
    const dynamic = new HttpArtifactAdapter(BASE_URL, () => ({ authToken: token }));
    fetchMock.mockImplementation(async () => json(templateList));
    await dynamic.listTemplates();
    token = "second";
    await dynamic.listTemplates();
    expect(
      fetchMock.mock.calls.map(([, init]) => new Headers(init.headers).get("Authorization"))
    ).toEqual(["Bearer first", "Bearer second"]);
  });

  it("builds getJob URL with encoded selector and verifies the snapshot scope", async () => {
    fetchMock.mockImplementation(async () => json(runningSnapshot));
    const snapshot = await adapter.getJob(jobSelector);
    expect(snapshot.state).toBe("running");
    const { raw } = lastCall();
    expect(raw).toBe(
      `${BASE_URL}/v1/image-jobs/${jobSelector.jobId}?session_id=session-synth-001&run_id=run-synth-001`
    );

    fetchMock.mockImplementation(async () => json(runningSnapshot));
    const wrongJob = await failureOf(adapter.getJob({ ...jobSelector, jobId: "other-job" }));
    expect(wrongJob.kind).toBe("protocol");
    const wrongRun = await failureOf(adapter.getJob({ ...jobSelector, runId: "run-other" }));
    expect(wrongRun.kind).toBe("protocol");
  });

  it("rejects unsafe identifiers locally without sending", async () => {
    for (const jobId of ["", "..", ".", "a/b", "a b", "a?b", "x".repeat(129)]) {
      const error = await failureOf(adapter.getJob({ ...jobSelector, jobId }));
      expect(error.kind).toBe("invalid_request");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("HttpArtifactAdapter createJob", () => {
  const request = {
    template_id: "general-image",
    prompt: "a red fox",
    session_id: "session-synth-002",
  };

  it("validates before sending and posts a strict JSON body expecting 202", async () => {
    const bad = await failureOf(adapter.createJob({ ...request, prompt: "" }));
    expect(bad.kind).toBe("invalid_request");
    const extra = await failureOf(
      adapter.createJob({ ...request, extra: 1 } as unknown as typeof request)
    );
    expect(extra.kind).toBe("invalid_request");
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(json(directSnapshot, 202));
    const snapshot = await adapter.createJob({ ...request, settings: { n: 1 } });
    expect(snapshot.job_id).toBe("00000000-0000-4000-8000-000000000002");
    const { url, init, headers } = lastCall();
    expect(url.pathname).toBe("/v1/image-jobs");
    expect(init.method).toBe("POST");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ ...request, settings: { n: 1 } });
  });

  it("treats a non-202 success status or foreign-session snapshot as protocol", async () => {
    fetchMock.mockResolvedValue(json(directSnapshot, 200));
    expect((await failureOf(adapter.createJob(request))).kind).toBe("protocol");
    fetchMock.mockResolvedValue(json(directSnapshot, 202));
    const foreign = await failureOf(
      adapter.createJob({ ...request, session_id: "session-synth-009" })
    );
    expect(foreign.kind).toBe("protocol");
  });

  it("rejects a response for another origin or template (contract-stable echo only)", async () => {
    const forged = [
      { ...directSnapshot, origin: "agent_tool", template_id: undefined, tool_call_id: "call_x" },
      { ...directSnapshot, template_id: "illustration" },
    ];
    for (const body of forged) {
      fetchMock.mockResolvedValue(json(body, 202));
      expect((await failureOf(adapter.createJob(request))).kind).toBe("protocol");
    }
    // Mutable state is never compared: any legitimate state for the echoed job is accepted.
    fetchMock.mockResolvedValue(json({ ...directSnapshot, state: "submitting" }, 202));
    expect((await adapter.createJob(request)).state).toBe("submitting");
  });
});

describe("HttpArtifactAdapter cancelJob", () => {
  const cancel = { ...jobSelector, expectedRevision: 3 };

  const cancelRequested = { ...runningSnapshot, state: "cancel_requested" };
  const terminal = (state: string, extra: Record<string, unknown> = {}) => ({
    ...runningSnapshot,
    state,
    completed_count: 0,
    safe_code: state === "cancelled" ? "image_cancelled" : "image_native_failed",
    terminal_at_ms: runningSnapshot.updated_at_ms,
    ...extra,
  });

  it("maps 202 to pending and 200 to terminal no-op, posting the exact body", async () => {
    fetchMock.mockResolvedValue(json(cancelRequested, 202));
    const pending = await adapter.cancelJob(cancel);
    expect(pending.pending).toBe(true);
    expect(pending.snapshot.state).toBe("cancel_requested");
    const { url, init } = lastCall();
    expect(url.pathname).toBe(`/v1/image-jobs/${jobSelector.jobId}/cancel`);
    expect(JSON.parse(init.body as string)).toEqual({
      session_id: "session-synth-001",
      run_id: "run-synth-001",
      expected_revision: 3,
    });

    fetchMock.mockResolvedValue(json(terminal("cancelled"), 200));
    const noop = await adapter.cancelJob(cancel);
    expect(noop).toMatchObject({ pending: false, snapshot: { state: "cancelled" } });
  });

  it("accepts 202 for a job that settled directly or raced to any terminal state", async () => {
    // Route: admitted/submitting cancel straight to `cancelled`; projection may re-read a later row.
    for (const state of ["cancelled", "failed", "indeterminate"]) {
      fetchMock.mockResolvedValue(json(terminal(state), 202));
      const result = await adapter.cancelJob(cancel);
      expect(result).toMatchObject({ pending: true, snapshot: { state } });
    }
  });

  it("fails closed when the status and the snapshot state disagree", async () => {
    // 200 is only ever returned for an already-terminal job.
    for (const body of [
      runningSnapshot,
      cancelRequested,
      { ...runningSnapshot, state: "admitted" },
    ]) {
      fetchMock.mockResolvedValue(json(body, 200));
      expect((await failureOf(adapter.cancelJob(cancel))).kind).toBe("protocol");
    }
    // 202 is only returned after the CAS: never an untouched active state.
    for (const state of ["admitted", "submitting", "running", "publishing"]) {
      fetchMock.mockResolvedValue(json({ ...runningSnapshot, state }, 202));
      expect((await failureOf(adapter.cancelJob(cancel))).kind).toBe("protocol");
    }
  });

  it("maps 409 to conflict and rejects invalid revisions before sending", async () => {
    fetchMock.mockResolvedValue(json({ error: { code: "image_conflict" } }, 409));
    const conflict = await failureOf(adapter.cancelJob(cancel));
    expect(conflict).toMatchObject({ kind: "conflict", status: 409 });
    fetchMock.mockClear();
    expect((await failureOf(adapter.cancelJob({ ...cancel, expectedRevision: 0 }))).kind).toBe(
      "invalid_request"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("HttpArtifactAdapter error mapping", () => {
  const cases: Array<[number, BodyInit | null, string]> = [
    [401, null, "unauthorized"],
    [404, JSON.stringify({ error: { code: "not_found" } }), "not_found"],
    [409, JSON.stringify({ error: { code: "image_conflict" } }), "conflict"],
    [422, JSON.stringify({ error: { code: "image_invalid_request" } }), "invalid_request"],
    [503, JSON.stringify({ error: { code: "image_busy" } }), "unavailable"],
    [500, "<html>boom</html>", "unavailable"],
    [429, null, "protocol"],
    [403, JSON.stringify({ error: { code: "image_policy_denied" } }), "not_found"],
  ];

  it.each(cases)("maps status %s to %s without echoing the body", async (status, body, kind) => {
    fetchMock.mockResolvedValue(new Response(body, { status }));
    const error = await failureOf(adapter.getJob(jobSelector));
    expect(error.kind).toBe(kind);
    // Denial (403/404) is uniform: the raw status is never exposed.
    expect(error.status).toBe(kind === "not_found" ? undefined : status);
    expect(error.message).toBe(`artifact_adapter_${kind}`);
  });

  it("carries only allowlisted safe codes for unavailable responses", async () => {
    fetchMock.mockResolvedValue(json({ error: { code: "image_busy" } }, 503));
    expect((await failureOf(adapter.getJob(jobSelector))).code).toBe("image_busy");
    fetchMock.mockResolvedValue(json({ error: { code: "/home/user/secret prompt" } }, 503));
    expect((await failureOf(adapter.getJob(jobSelector))).code).toBeUndefined();
    fetchMock.mockResolvedValue(json({ error: { code: "not_found" } }, 503));
    expect((await failureOf(adapter.getJob(jobSelector))).code).toBeUndefined();
    fetchMock.mockResolvedValue(new Response("x".repeat(70 * 1024), { status: 503 }));
    expect((await failureOf(adapter.getJob(jobSelector))).code).toBeUndefined();
  });

  it("treats every 404 identically (no oracle) and never leaks body text", async () => {
    const bodies = [
      JSON.stringify({ error: { code: "not_found" } }),
      JSON.stringify({
        error: { code: "image_artifact_unavailable", detail: "/srv/private/path prompt" },
      }),
      "",
    ];
    const errors: ArtifactAdapterError[] = [];
    for (const body of bodies) {
      fetchMock.mockResolvedValue(new Response(body, { status: 404 }));
      errors.push(await failureOf(adapter.getJob(jobSelector)));
    }
    for (const error of errors) {
      expect(error.kind).toBe("not_found");
      expect(error.code).toBeUndefined();
      expect(error.message).toBe(errors[0]?.message);
      expect(JSON.stringify(error)).not.toContain("private");
    }
  });

  it("maps fetch failures to network, and caller abort to aborted", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch http://secret"));
    const network = await failureOf(adapter.getJob(jobSelector));
    expect(network.kind).toBe("network");
    expect(network.message).not.toContain("secret");

    const controller = new AbortController();
    controller.abort();
    fetchMock.mockClear();
    const aborted = await failureOf(adapter.getJob(jobSelector, { signal: controller.signal }));
    expect(aborted.kind).toBe("aborted");
    expect(fetchMock).not.toHaveBeenCalled();

    const live = new AbortController();
    fetchMock.mockImplementation(async () => {
      live.abort();
      throw new DOMException("aborted", "AbortError");
    });
    expect((await failureOf(adapter.getJob(jobSelector, { signal: live.signal }))).kind).toBe(
      "aborted"
    );
  });

  it("treats undecodable or oversize JSON as protocol", async () => {
    fetchMock.mockResolvedValue(new Response("{not json", { status: 200 }));
    expect((await failureOf(adapter.getJob(jobSelector))).kind).toBe("protocol");
    fetchMock.mockResolvedValue(json({ schema: "image_job.v1" }));
    expect((await failureOf(adapter.getJob(jobSelector))).kind).toBe("protocol");
    fetchMock.mockResolvedValue(new Response("x".repeat(300 * 1024), { status: 200 }));
    expect((await failureOf(adapter.getJob(jobSelector))).kind).toBe("protocol");
  });
});

describe("HttpArtifactAdapter artifact listing", () => {
  it("builds a page URL with default limit and URL-encoded components", async () => {
    fetchMock.mockImplementation(async () => page([], null));
    await adapter.listArtifactsPage({ sessionId: "session-synth-001" });
    expect(lastCall().raw).toBe(
      `${BASE_URL}/v1/sessions/session-synth-001/image-artifacts?limit=20`
    );

    await adapter.listArtifactsPage({
      sessionId: "session-synth-001",
      runId: "run-synth-001",
      cursor: "ab+c/d=e&f#g",
      limit: 100,
    });
    const { url } = lastCall();
    expect(lastCall().raw).toContain("cursor=ab%2Bc%2Fd%3De%26f%23g");
    expect(url.searchParams.get("cursor")).toBe("ab+c/d=e&f#g");
    expect(url.searchParams.get("run_id")).toBe("run-synth-001");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.hash).toBe("");
  });

  it("rejects out-of-range limits, bad cursors and unsafe ids before sending", async () => {
    fetchMock.mockClear();
    for (const limit of [0, 101, 1.5, Number.NaN]) {
      expect((await failureOf(adapter.listArtifactsPage({ sessionId: "s1", limit }))).kind).toBe(
        "invalid_request"
      );
    }
    for (const cursor of ["", "x".repeat(1025)]) {
      expect((await failureOf(adapter.listArtifactsPage({ sessionId: "s1", cursor }))).kind).toBe(
        "invalid_request"
      );
    }
    expect((await failureOf(adapter.listArtifactsPage({ sessionId: ".." }))).kind).toBe(
      "invalid_request"
    );
    expect(
      (await failureOf(adapter.listArtifactsPage({ sessionId: "s1", runId: "a/b" }))).kind
    ).toBe("invalid_request");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects items from a foreign session or run", async () => {
    fetchMock.mockResolvedValue(page([artifact("a1", { session_id: "session-other" })], null));
    expect(
      (await failureOf(adapter.listArtifactsPage({ sessionId: "session-synth-001" }))).kind
    ).toBe("protocol");
    fetchMock.mockResolvedValue(page([artifact("a1", { run_id: "run-other" })], null));
    const foreignRun = await failureOf(
      adapter.listArtifactsPage({ sessionId: "session-synth-001", runId: "run-synth-001" })
    );
    expect(foreignRun.kind).toBe("protocol");
  });

  it("follows cursors through empty pages and de-duplicates by artifact_id", async () => {
    const responses = [
      () => page([artifact("a1"), artifact("a2", { ordinal: 1 })], "c1"),
      () => page([], "c2"),
      () => page([artifact("a2", { ordinal: 1 }), artifact("a3", { ordinal: 2 })], "c3"),
      () => page([], null),
    ];
    fetchMock.mockImplementation(async () => (responses.shift() as () => Response)());
    const items = await adapter.listAllArtifacts({
      sessionId: "session-synth-001",
      runId: "run-synth-001",
    });
    expect(items.map((item) => item.artifact_id)).toEqual(["a1", "a2", "a3"]);
    const urls = fetchMock.mock.calls.map(([raw]) => new URL(raw));
    expect(urls.map((u) => u.searchParams.get("cursor"))).toEqual([null, "c1", "c2", "c3"]);
    expect(urls.every((u) => u.searchParams.get("limit") === "100")).toBe(true);
  });

  it("fails closed with page_cap when pagination never ends", async () => {
    let n = 0;
    fetchMock.mockImplementation(async () => page([], `cursor-${(n += 1)}`));
    const error = await failureOf(adapter.listAllArtifacts({ sessionId: "session-synth-001" }));
    expect(error.kind).toBe("page_cap");
    expect(fetchMock).toHaveBeenCalledTimes(ARTIFACT_MAX_LIST_PAGES);
  });

  it("fails as protocol when the daemon repeats a cursor", async () => {
    fetchMock.mockImplementation(async () => page([], "same"));
    const error = await failureOf(adapter.listAllArtifacts({ sessionId: "session-synth-001" }));
    expect(error.kind).toBe("protocol");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("propagates an authorization failure mid-pagination without partial results", async () => {
    const responses = [
      () => page([artifact("a1")], "c1"),
      () => new Response(null, { status: 401 }),
    ];
    fetchMock.mockImplementation(async () => (responses.shift() as () => Response)());
    const error = await failureOf(adapter.listAllArtifacts({ sessionId: "session-synth-001" }));
    expect(error.kind).toBe("unauthorized");
  });
});

describe("HttpArtifactAdapter artifact bytes", () => {
  it("fetches verified bytes with exact URL, header auth, and a fresh GET each time", async () => {
    fetchMock.mockImplementation(async () =>
      pngResponse(new Blob([PNG_256]).stream(), { "Content-Length": String(PNG_256.byteLength) })
    );
    const first = await adapter.fetchArtifactBytes(bytesRequest);
    expect(first.type).toBe("image/png");
    const { raw, init, headers } = lastCall();
    expect(raw).toBe(
      `${BASE_URL}/v1/image-artifacts/${bytesRequest.artifactId}?session_id=session-synth-001&run_id=run-synth-001&disposition=inline`
    );
    expect(raw).not.toContain(TOKEN);
    expect(headers.get("Authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("Accept")).toBe("image/png");
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-store");
    await adapter.fetchArtifactBytes(bytesRequest);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("downloads with disposition=attachment and a client-derived filename", async () => {
    fetchMock.mockImplementation(async () => pngResponse(new Blob([PNG_256]).stream()));
    const download = await adapter.downloadArtifact(bytesRequest);
    expect(download.filename).toBe(`${bytesRequest.artifactId}.png`);
    expect(download.blob.type).toBe("image/png");
    expect(lastCall().url.searchParams.get("disposition")).toBe("attachment");
    await adapter.downloadArtifact(bytesRequest);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps byte-route statuses without reading the body into an error", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "not_found" } }), { status: 404 })
    );
    expect((await failureOf(adapter.fetchArtifactBytes(bytesRequest))).kind).toBe("not_found");
    fetchMock.mockResolvedValue(json({ error: { code: "image_resource_unavailable" } }, 503));
    const busy = await failureOf(adapter.fetchArtifactBytes(bytesRequest));
    expect(busy).toMatchObject({ kind: "unavailable", code: "image_resource_unavailable" });
    fetchMock.mockResolvedValue(pngResponse(new Blob([PNG_256]).stream(), {}, 206));
    expect((await failureOf(adapter.fetchArtifactBytes(bytesRequest))).kind).toBe("protocol");
  });

  it("surfaces integrity failures from verification and cancels oversize streams", async () => {
    fetchMock.mockImplementation(async () => pngResponse(new Blob([PNG_256]).stream()));
    const wrongHash = await failureOf(
      adapter.fetchArtifactBytes({ ...bytesRequest, sha256: "f".repeat(64) })
    );
    expect(wrongHash.kind).toBe("integrity");

    const probe = { pulled: 0, cancelled: false };
    fetchMock.mockImplementation(async () =>
      pngResponse(probedStream([PNG_256, new Uint8Array(1), new Uint8Array(1024)], probe))
    );
    const oversize = await failureOf(adapter.fetchArtifactBytes(bytesRequest));
    expect(oversize.kind).toBe("too_large");
    expect(probe.cancelled).toBe(true);
  });

  it("honors the abort signal before and during the request", async () => {
    const pre = new AbortController();
    pre.abort();
    expect(
      (await failureOf(adapter.fetchArtifactBytes(bytesRequest, { signal: pre.signal }))).kind
    ).toBe("aborted");
    expect(fetchMock).not.toHaveBeenCalled();

    const probe = { pulled: 0, cancelled: false };
    const live = new AbortController();
    // Abort while the response is in flight: the stream must be cancelled, not read.
    fetchMock.mockImplementation(async () => {
      live.abort();
      return pngResponse(probedStream([PNG_256.slice(0, 10)], probe, { hang: true }));
    });
    const pending = adapter.fetchArtifactBytes(bytesRequest, { signal: live.signal });
    expect((await failureOf(pending)).kind).toBe("aborted");
    expect(probe.cancelled).toBe(true);
  });

  it("rejects invalid byte metadata before sending", async () => {
    const patches = [
      { artifactId: ".." },
      { byteSize: 0 },
      { sha256: "xyz" },
      { sha256: 42 as unknown as string },
      { width: 0 },
      { width: 255 },
      { width: 257 },
      { height: 2080 },
      { width: 4096, height: 1024 },
    ];
    for (const patch of patches) {
      const error = await failureOf(adapter.fetchArtifactBytes({ ...bytesRequest, ...patch }));
      expect(error.kind).toBe("invalid_request");
    }
  });
});

describe("HttpArtifactAdapter transport hardening", () => {
  const cancelBody = { ...jobSelector, expectedRevision: 3 };
  const createBody = {
    template_id: "general-image",
    prompt: "a red fox",
    session_id: "session-synth-002",
  };

  /** Routes by path so every request kind gets a coherent success response. */
  function route(raw: string): Response {
    const { pathname } = new URL(raw);
    if (pathname === "/v1/image-templates") return json(templateList);
    if (pathname === "/v1/image-jobs") return json(directSnapshot, 202);
    if (pathname.endsWith("/cancel"))
      return json({ ...runningSnapshot, state: "cancel_requested" }, 202);
    if (pathname.startsWith("/v1/image-jobs/")) return json(runningSnapshot);
    if (pathname.startsWith("/v1/image-artifacts/"))
      return pngResponse(new Blob([PNG_256]).stream());
    return page([], null);
  }

  it("sends redirect: 'error' on every artifact request", async () => {
    fetchMock.mockImplementation(async (raw) => route(raw));
    await adapter.listTemplates();
    await adapter.createJob(createBody);
    await adapter.getJob(jobSelector);
    await adapter.cancelJob(cancelBody);
    await adapter.listArtifactsPage({ sessionId: "session-synth-001" });
    await adapter.listAllArtifacts({ sessionId: "session-synth-001" });
    await adapter.fetchArtifactBytes(bytesRequest);
    await adapter.downloadArtifact(bytesRequest);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(8);
    for (const [, init] of fetchMock.mock.calls) expect(init.redirect).toBe("error");
  });

  it("maps a redirect (fetch rejects under redirect: 'error') to network without following it", async () => {
    const redirect = new Response(null, {
      status: 302,
      headers: { Location: "http://evil.test/" },
    });
    // Same observable behavior as WHATWG fetch: `error` mode rejects instead of surfacing the 3xx.
    fetchMock.mockImplementation(async (_raw, init) => {
      if (init.redirect === "error") throw new TypeError("redirect mode is set to error");
      return redirect;
    });
    expect((await failureOf(adapter.getJob(jobSelector))).kind).toBe("network");
    expect((await failureOf(adapter.fetchArtifactBytes(bytesRequest))).kind).toBe("network");
    expect(fetchMock.mock.calls.every(([raw]) => !raw.includes("evil.test"))).toBe(true);
  });

  it("treats 403 exactly like 404: uniform not_found, body never read", async () => {
    const errors: ArtifactAdapterError[] = [];
    for (const status of [403, 404]) {
      // Two chunks: a stream prefetches one (highWaterMark), so pulled <= 1 proves nothing was read.
      const probe = { pulled: 0, cancelled: false };
      const body = new TextEncoder().encode(JSON.stringify({ error: { code: "image_busy" } }));
      const chunks = [body.slice(0, 5), body.slice(5)];
      fetchMock.mockImplementation(
        async () => new Response(probedStream(chunks, probe), { status })
      );
      errors.push(await failureOf(adapter.getJob(jobSelector)));
      expect(probe.pulled).toBeLessThanOrEqual(1);
      expect(probe.cancelled).toBe(true);

      const bytesProbe = { pulled: 0, cancelled: false };
      fetchMock.mockImplementation(
        async () => new Response(probedStream(chunks, bytesProbe), { status })
      );
      errors.push(await failureOf(adapter.fetchArtifactBytes(bytesRequest)));
      expect(bytesProbe.pulled).toBeLessThanOrEqual(1);
      expect(bytesProbe.cancelled).toBe(true);
    }
    for (const error of errors) {
      expect(error.kind).toBe("not_found");
      expect(error.code).toBeUndefined();
      expect(error.message).toBe("artifact_adapter_not_found");
    }
  });

  it("fails closed with `unsupported` and cancels the body when crypto.subtle is missing", async () => {
    vi.stubGlobal("crypto", {});
    const probe = { pulled: 0, cancelled: false };
    fetchMock.mockImplementation(async () =>
      pngResponse(probedStream([PNG_256.slice(0, 60), PNG_256.slice(60)], probe))
    );
    const error = await failureOf(adapter.fetchArtifactBytes(bytesRequest));
    expect(error.kind).toBe("unsupported");
    expect(probe.pulled).toBeLessThanOrEqual(1);
    expect(probe.cancelled).toBe(true);
  });
});

describe("HttpArtifactAdapter listAllArtifacts duplicate handling", () => {
  const sessionId = "session-synth-001";

  function listWithSecondPage(duplicate: Record<string, unknown>): void {
    const responses = [
      () => page([artifact("a1"), artifact("a2", { ordinal: 1 })], "c1"),
      () => page([duplicate], null),
    ];
    fetchMock.mockImplementation(async () => (responses.shift() as () => Response)());
  }

  it("tolerates an identical duplicate across a page boundary", async () => {
    listWithSecondPage(artifact("a2", { ordinal: 1 }));
    const items = await adapter.listAllArtifacts({ sessionId });
    expect(items.map((item) => item.artifact_id)).toEqual(["a1", "a2"]);
  });

  it("fails closed with protocol when a later duplicate differs in ANY field", async () => {
    const conflicts: Array<Record<string, unknown>> = [
      { sha256: "f".repeat(64) },
      { byte_size: 1048577 },
      { width: 544 },
      { height: 544 },
      { ordinal: 2 },
      { created_at_ms: 1700000009999 },
      { state: "unavailable" },
      { job_id: "00000000-0000-4000-8000-000000000009" },
      { run_id: "run-synth-001", tool_call_id: undefined },
    ];
    for (const patch of conflicts) {
      listWithSecondPage(artifact("a2", { ordinal: 1, ...patch }));
      expect((await failureOf(adapter.listAllArtifacts({ sessionId }))).kind).toBe("protocol");
    }
  });
});
