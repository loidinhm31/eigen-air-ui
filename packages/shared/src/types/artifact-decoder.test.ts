// @ts-expect-error Node test runtime provides fs; browser package intentionally has no Node types.
import { readFileSync } from "node:fs";
// @ts-expect-error Node test runtime provides crypto; browser package intentionally has no Node types.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decodeImageArtifactCommittedEvent,
  decodeImageArtifactList,
  decodeImageArtifactRef,
  decodeImageHintWsEvent,
  decodeImageJobSnapshot,
  decodeImageJobUpdatedEvent,
  decodeImageResult,
  decodeImageTemplateList,
  ImageDecodeError,
  isImageHintEventName,
  isImageId,
  validateImageJobCancelRequest,
  validateImageJobCreateRequest,
} from "./artifact-decoder.js";
import {
  IMAGE_OUTPUT_DIMENSION_ALIGNMENT,
  IMAGE_OUTPUT_MAX_EDGE,
  IMAGE_OUTPUT_MAX_PIXELS,
  IMAGE_OUTPUT_MIN_EDGE,
  imageGenerationAvailable,
  imageReadersAvailable,
} from "./artifact.js";
import * as barrel from "./index.js";

// Fixture JSON is untrusted-shape test data; any keeps mutations terse.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

// cwd-independent: resolved relative to this file (packages/shared/src/types -> repo root).
const bytes = readFileSync(
  new URL("../../../../test-fixtures/contracts/local-image-v1.json", import.meta.url)
);
const fixture = JSON.parse(bytes.toString("utf8")) as Json;
const vectors = fixture.vectors as Json;
const hints = fixture.ws_hints as Json;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mutated(base: Json, fn: (copy: Json) => void): Json {
  const copy = clone(base);
  fn(copy);
  return copy;
}

const committed = vectors.artifact_refs.committed_artifact as Json;
const snapshot = vectors.snapshots.job_snapshot_succeeded as Json;
const agentSnapshot = vectors.snapshots.job_snapshot_running as Json;
const result = vectors.results.direct_template_success as Json;
const jobHint = hints.events.job_updated_active as Json;
const artifactHint = hints.events.artifact_committed as Json;

describe("local-image-v1 fixture", () => {
  it("pins the exact backend-generated fixture bytes", () => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "c149e29deb53071f77c9e35cf2d86ecbd509ccda2abe5c828b7df63a84c05001"
    );
  });

  it("decodes artifact refs, including the unavailable zero-byte vector", () => {
    expect(decodeImageArtifactRef(committed)).toEqual(committed);
    const unavailable = decodeImageArtifactRef(vectors.artifact_refs.unavailable_artifact);
    expect(unavailable).toMatchObject({ state: "unavailable", byte_size: 0 });
    expect(unavailable.sha256).toBe("0".repeat(64));
  });

  it("decodes every result vector", () => {
    const names = Object.keys(vectors.results);
    expect(names.length).toBeGreaterThanOrEqual(6);
    for (const name of names) {
      const decoded = decodeImageResult(vectors.results[name]);
      expect(decoded.schema).toBe("image_result.v1");
      expect(decoded.artifacts.length).toBeLessThanOrEqual(4);
    }
    expect(decodeImageResult(vectors.results.unavailable_safe_code).safe_code).toBe(
      "image_resource_unavailable"
    );
  });

  it("decodes every snapshot vector and normalizes absent/null optionals", () => {
    for (const name of Object.keys(vectors.snapshots)) {
      expect(decodeImageJobSnapshot(vectors.snapshots[name]).schema).toBe("image_job.v1");
    }
    const active = decodeImageJobSnapshot(agentSnapshot);
    expect(active).toMatchObject({
      safe_code: null,
      terminal_at_ms: null,
      tool_call_id: "call_synth_agent_001",
    });
    expect("template_id" in active).toBe(false);
    // Rust omits None optionals on the wire: absent == null.
    const omitted = decodeImageJobSnapshot(
      mutated(agentSnapshot, (s) => {
        delete s.safe_code;
        delete s.terminal_at_ms;
      })
    );
    expect(omitted).toEqual(active);
    expect(decodeImageJobSnapshot(snapshot)).toMatchObject({
      origin: "direct_template",
      template_id: "general-image",
      terminal_at_ms: 1700000003850,
    });
  });

  it("decodes artifact lists and normalizes next_cursor", () => {
    const first = decodeImageArtifactList(vectors.artifact_lists.artifact_list_valid);
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.next_cursor).toBeNull();
    const page = decodeImageArtifactList(vectors.artifact_lists.artifact_list_paginated);
    expect(page.next_cursor).toBe("cursor-synth-epoch-02");
    const explicitNull = mutated(vectors.artifact_lists.artifact_list_valid, (l) => {
      l.next_cursor = null;
    });
    expect(decodeImageArtifactList(explicitNull).next_cursor).toBeNull();
  });

  it("decodes the public template list and rejects the internal manifest", () => {
    const list = decodeImageTemplateList(vectors.templates.public_list_example);
    expect(list.revision).toBe(1);
    expect(list.templates[0]).toMatchObject({
      id: "general-image",
      defaults: { quality: "balanced", size: "square", n: 1 },
    });
    expect(() => decodeImageTemplateList(vectors.templates.manifest_example)).toThrow(
      ImageDecodeError
    );
  });

  it("decodes every ws hint event and matches the fixture allowlists", () => {
    for (const name of Object.keys(hints.events)) {
      const frame = hints.events[name];
      const decoded = decodeImageHintWsEvent(frame);
      expect(decoded).toEqual(frame);
      const allowed =
        frame.event === "image_job.updated"
          ? hints.job_updated_allowed_fields
          : hints.artifact_committed_allowed_fields;
      expect(Object.keys(frame.payload).every((k) => allowed.includes(k))).toBe(true);
    }
    expect(
      decodeImageJobUpdatedEvent(hints.events.job_updated_terminal_failed).payload.safe_code
    ).toBe("image_native_failed");
    expect(decodeImageArtifactCommittedEvent(artifactHint).payload.ordinal).toBe(0);
  });
});

describe("fixture rejection vectors relevant to wire decoding", () => {
  const rej = vectors.rejections as Json;

  it("rejects extra private key in snapshot", () => {
    expect(() => decodeImageJobSnapshot(rej.extra_key_snapshot.payload)).toThrow(ImageDecodeError);
    expect(() =>
      decodeImageJobSnapshot(mutated(snapshot, (s) => (s.private_host_path = "/var/data/x.png")))
    ).toThrow(ImageDecodeError);
  });

  it("rejects schema mismatches", () => {
    expect(() => decodeImageResult(rej.schema_mismatch_result.payload)).toThrow(ImageDecodeError);
    expect(() => decodeImageJobSnapshot(rej.schema_mismatch_job.payload)).toThrow(ImageDecodeError);
    expect(() => decodeImageResult(mutated(result, (r) => (r.schema = "image_result.v2")))).toThrow(
      ImageDecodeError
    );
    expect(() =>
      decodeImageJobSnapshot(mutated(snapshot, (s) => (s.schema = "image_job.legacy")))
    ).toThrow(ImageDecodeError);
    // Cross-schema confusion.
    expect(() => decodeImageJobSnapshot(result)).toThrow(ImageDecodeError);
    expect(() => decodeImageResult(snapshot)).toThrow(ImageDecodeError);
  });

  it("rejects invalid artifact mime, ordinal and sha256 (partial and mutated)", () => {
    for (const name of [
      "artifact_mime_invalid",
      "artifact_ordinal_out_of_range",
      "artifact_sha256_invalid",
    ]) {
      expect(() => decodeImageArtifactRef(rej[name].payload)).toThrow(ImageDecodeError);
      expect(() =>
        decodeImageArtifactRef(
          mutated(committed, (a) => {
            const { schema: _ignored, ...patch } = rej[name].payload;
            void _ignored;
            Object.assign(a, patch);
          })
        )
      ).toThrow(ImageDecodeError);
    }
    expect(() =>
      decodeImageArtifactRef(mutated(committed, (a) => (a.sha256 = a.sha256.toUpperCase())))
    ).toThrow(ImageDecodeError);
  });

  it("rejects the request-side vectors in the create validator", () => {
    const base = { template_id: "general-image", prompt: "p", session_id: "s1" };
    expect(() =>
      validateImageJobCreateRequest({
        ...base,
        prompt: "a".repeat(rej.prompt_too_long.byte_length),
      })
    ).toThrow(ImageDecodeError);
    expect(() =>
      validateImageJobCreateRequest({ ...base, prompt: rej.prompt_contains_nul.payload.prompt })
    ).toThrow(ImageDecodeError);
    expect(() =>
      validateImageJobCreateRequest({
        ...base,
        negative_prompt: "a".repeat(rej.negative_prompt_too_long.byte_length),
      })
    ).toThrow(ImageDecodeError);
    expect(() =>
      validateImageJobCreateRequest({
        ...base,
        negative_prompt: rej.negative_prompt_contains_nul.payload.negative_prompt,
      })
    ).toThrow(ImageDecodeError);
    for (const name of ["count_below_min", "count_above_max"]) {
      expect(() =>
        validateImageJobCreateRequest({ ...base, settings: { n: rej[name].payload.n } })
      ).toThrow(ImageDecodeError);
    }
    expect(() =>
      validateImageJobCreateRequest({
        ...base,
        settings: { seed: rej.seed_out_of_range.payload.seed },
      })
    ).toThrow(ImageDecodeError);
  });
});

describe("strict wire decoding negatives", () => {
  it("rejects extra and missing keys at every level", () => {
    expect(() => decodeImageArtifactRef(mutated(committed, (a) => (a.extra = 1)))).toThrow(
      ImageDecodeError
    );
    expect(() => decodeImageArtifactRef(mutated(committed, (a) => delete a.sha256))).toThrow(
      ImageDecodeError
    );
    // Nested extra key inside a snapshot's artifact.
    expect(() =>
      decodeImageJobSnapshot(
        mutated(snapshot, (s) => (s.artifacts[0].relative_path = "local-image/x/0.png"))
      )
    ).toThrow(ImageDecodeError);
    expect(() => decodeImageJobSnapshot(mutated(snapshot, (s) => delete s.revision))).toThrow(
      ImageDecodeError
    );
    expect(() =>
      decodeImageArtifactList(
        mutated(vectors.artifact_lists.artifact_list_valid, (l) => (l.items[0].x = 1))
      )
    ).toThrow(ImageDecodeError);
    expect(() =>
      decodeImageTemplateList(
        mutated(vectors.templates.public_list_example, (l) => (l.templates[0].defaults.steps = 20))
      )
    ).toThrow(ImageDecodeError);
    expect(() =>
      decodeImageTemplateList(
        mutated(
          vectors.templates.public_list_example,
          (l) => (l.templates[0].prompt_template = "{prompt}")
        )
      )
    ).toThrow(ImageDecodeError);
    expect(() => decodeImageResult(mutated(result, (r) => (r.extra = true)))).toThrow(
      ImageDecodeError
    );
  });

  it("rejects non-object and array input", () => {
    for (const bad of [null, undefined, 1, "x", [], [committed]]) {
      expect(() => decodeImageArtifactRef(bad)).toThrow(ImageDecodeError);
      expect(() => decodeImageJobSnapshot(bad)).toThrow(ImageDecodeError);
      expect(() => decodeImageArtifactList(bad)).toThrow(ImageDecodeError);
      expect(() => decodeImageHintWsEvent(bad)).toThrow(ImageDecodeError);
    }
  });

  it("enforces identifier charset and length", () => {
    for (const bad of ["", "a b", "a/b", "é", "a\n", "x".repeat(129)]) {
      expect(() =>
        decodeImageArtifactRef(mutated(committed, (a) => (a.artifact_id = bad)))
      ).toThrow(ImageDecodeError);
    }
    expect(() =>
      decodeImageArtifactRef(mutated(committed, (a) => (a.tool_call_id = null)))
    ).toThrow(ImageDecodeError);
    const ok = "A.b_c:d-9".padEnd(128, "z");
    expect(decodeImageArtifactRef(mutated(committed, (a) => (a.run_id = ok))).run_id).toBe(ok);
  });

  it("enforces artifact bounds", () => {
    const bad: Array<(a: Json) => void> = [
      (a) => (a.ordinal = -1),
      (a) => (a.ordinal = 1.5),
      (a) => (a.width = 0),
      (a) => (a.height = -4),
      (a) => (a.width = 2049),
      (a) => ((a.width = 2048), (a.height = 2080)),
      (a) => (a.width = 512.5),
      (a) => (a.byte_size = 0),
      (a) => (a.byte_size = 16 * 1024 * 1024 + 1),
      (a) => (a.byte_size = "1"),
      (a) => (a.sha256 = "a".repeat(63)),
      (a) => (a.sha256 = "g".repeat(64)),
      (a) => (a.mime = "image/png; charset=x"),
      (a) => (a.state = "pending"),
      (a) => (a.created_at_ms = -1),
      (a) => (a.created_at_ms = Number.MAX_SAFE_INTEGER + 2),
      (a) => (a.created_at_ms = 1.5),
    ];
    for (const fn of bad) {
      expect(() => decodeImageArtifactRef(mutated(committed, fn))).toThrow(ImageDecodeError);
    }
    const max = mutated(committed, (a) => {
      a.byte_size = 16 * 1024 * 1024;
      a.width = 2048;
      a.height = 2048;
      a.ordinal = 3;
    });
    expect(decodeImageArtifactRef(max).byte_size).toBe(16 * 1024 * 1024);
    // Non-committed refs may report zero bytes; committed may not.
    expect(
      decodeImageArtifactRef(mutated(committed, (a) => ((a.state = "deleted"), (a.byte_size = 0))))
    ).toBeTruthy();
  });

  it("enforces job counts, revision, state, safe_code and origin coherence", () => {
    const bad: Array<(s: Json) => void> = [
      (s) => (s.revision = 0),
      (s) => (s.state = "queued"),
      (s) => (s.safe_code = "boom"),
      (s) => (s.requested_count = 5),
      (s) => (s.requested_count = 0),
      (s) => (s.completed_count = 2),
      (s) => (s.terminal_at_ms = -5),
      (s) => (s.created_at_ms = 1.5),
      (s) => (s.effective_quality = "ultra"),
      (s) => (s.effective_backend = "gpu"),
      (s) => (s.effective_steps = 3),
      (s) => (s.effective_width = 0),
      (s) => (s.origin = "agent_tool"), // direct_template snapshot carries template_id, no tool_call_id
      (s) => (s.origin = "other"),
      (s) => (s.tool_call_id = "call-1"), // direct_template forbids tool_call_id
      (s) => delete s.template_id,
    ];
    for (const fn of bad) {
      expect(() => decodeImageJobSnapshot(mutated(snapshot, fn))).toThrow(ImageDecodeError);
    }
    expect(() =>
      decodeImageJobSnapshot(mutated(agentSnapshot, (s) => (s.template_id = "general-image")))
    ).toThrow(ImageDecodeError);
    expect(() =>
      decodeImageJobSnapshot(mutated(agentSnapshot, (s) => delete s.tool_call_id))
    ).toThrow(ImageDecodeError);
  });

  it("rejects more than 4 artifacts and artifacts outside the job scope", () => {
    const five = mutated(snapshot, (s) => {
      s.requested_count = 4;
      s.completed_count = 4;
      s.artifacts = Array.from({ length: 5 }, (_, i) => ({
        ...s.artifacts[0],
        artifact_id: `art-${i}`,
        ordinal: i % 4,
      }));
    });
    expect(() => decodeImageJobSnapshot(five)).toThrow(ImageDecodeError);
    const scoped: Array<(a: Json) => void> = [
      (a) => (a.job_id = "other-job"),
      (a) => (a.session_id = "other-session"),
      (a) => (a.run_id = "other-run"),
      (a) => (a.tool_call_id = "call-1"),
      (a) => (a.ordinal = 1), // >= requested_count
    ];
    for (const fn of scoped) {
      expect(() => decodeImageJobSnapshot(mutated(snapshot, (s) => fn(s.artifacts[0])))).toThrow(
        ImageDecodeError
      );
    }
    const dup = mutated(vectors.results.agent_tool_success, (r) => {
      r.artifacts[1].ordinal = 0;
    });
    expect(() => decodeImageResult(dup)).toThrow(ImageDecodeError);
  });

  it("accepts a four-artifact result with maximal ids inside the 8 KiB budget", () => {
    const ids = "z".repeat(128);
    const big = mutated(vectors.results.agent_tool_success, (r) => {
      r.job_id = ids;
      r.session_id = ids;
      r.run_id = ids;
      r.tool_call_id = ids;
      r.requested_count = 4;
      r.completed_count = 4;
      r.artifacts = [0, 1, 2, 3].map((i) => ({
        ...r.artifacts[0],
        artifact_id: `${i}`.repeat(128),
        job_id: ids,
        session_id: ids,
        run_id: ids,
        tool_call_id: ids,
        ordinal: i,
      }));
    });
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeLessThanOrEqual(8192);
    expect(decodeImageResult(big).artifacts).toHaveLength(4);
  });

  it("rejects oversize artifact lists and bad cursors", () => {
    const list = (n: number) =>
      mutated(vectors.artifact_lists.artifact_list_valid, (l) => {
        l.items = Array.from({ length: n }, (_, i) => ({ ...l.items[0], artifact_id: `a-${i}` }));
      });
    expect(decodeImageArtifactList(list(100)).items).toHaveLength(100);
    expect(() => decodeImageArtifactList(list(101))).toThrow(ImageDecodeError);
    const withCursor = (c: unknown) =>
      mutated(vectors.artifact_lists.artifact_list_valid, (l) => (l.next_cursor = c));
    expect(decodeImageArtifactList(withCursor("c".repeat(1024))).next_cursor).toHaveLength(1024);
    for (const bad of ["c".repeat(1025), "", 5, "a\u0000b"]) {
      expect(() => decodeImageArtifactList(withCursor(bad))).toThrow(ImageDecodeError);
    }
  });

  it("enforces template list bounds", () => {
    const pub = vectors.templates.public_list_example;
    const bad: Array<(l: Json) => void> = [
      (l) => (l.revision = 0),
      (l) => (l.schema = "image_templates.v1"),
      (l) => (l.templates[0].editable_fields = ["prompt", "prompt"]),
      (l) => (l.templates[0].editable_fields = ["install"]),
      (l) => (l.templates[0].defaults.n = 5),
      (l) => (l.templates[0].defaults.size = "9999x9999"),
      (l) => (l.templates[0].defaults.quality = "ultra"),
      (l) => (l.templates[0].name = ""),
      (l) => (l.templates[1].id = l.templates[0].id),
      (l) =>
        (l.templates = Array.from({ length: 17 }, (_, i) => ({ ...l.templates[0], id: `t-${i}` }))),
    ];
    for (const fn of bad) {
      expect(() => decodeImageTemplateList(mutated(pub, fn))).toThrow(ImageDecodeError);
    }
  });

  it("never echoes raw wire text in error messages", () => {
    const secret = "SECRET-wire-value-/etc/passwd";
    const attempts: Array<() => unknown> = [
      () => decodeImageArtifactRef(mutated(committed, (a) => (a[secret] = secret))),
      () => decodeImageArtifactRef(mutated(committed, (a) => (a.artifact_id = secret))),
      () => decodeImageJobSnapshot(mutated(snapshot, (s) => (s.schema = secret))),
      () => decodeImageHintWsEvent({ event: secret }),
      () =>
        validateImageJobCreateRequest({
          template_id: "t",
          prompt: "\u0000" + secret,
          session_id: "s",
        }),
    ];
    for (const attempt of attempts) {
      try {
        attempt();
        throw new Error("expected decode failure");
      } catch (error) {
        expect(error).toBeInstanceOf(ImageDecodeError);
        expect((error as Error).name).toBe("ImageDecodeError");
        expect((error as Error).message).not.toContain("SECRET");
        expect((error as Error).message).not.toContain("passwd");
      }
    }
  });
});

describe("job/result cross-field coherence (Rust validate parity)", () => {
  const partial = vectors.snapshots.job_snapshot_partial_cancelled as Json;
  const partialResult = vectors.results.retained_partial_failure as Json;
  const agentResult = vectors.results.agent_tool_success as Json;
  const terminalFailed = (s: Json) => {
    s.state = "failed";
    s.safe_code = "image_native_failed";
    s.terminal_at_ms = s.updated_at_ms;
  };

  const snapshotRejections: Array<[string, Json, (s: Json) => void]> = [
    ["succeeded without its artifact", snapshot, (s) => (s.artifacts = [])],
    ["succeeded with completed_count 0 but an artifact", snapshot, (s) => (s.completed_count = 0)],
    ["succeeded with completed < requested", snapshot, (s) => (s.requested_count = 2)],
    [
      "failed with completed artifacts",
      snapshot,
      (s) => ((s.state = "failed"), (s.safe_code = "image_native_failed")),
    ],
    [
      "cancelled with completed artifacts",
      snapshot,
      (s) => ((s.state = "cancelled"), (s.safe_code = "image_cancelled")),
    ],
    [
      "partial_failed with zero completed",
      partial,
      (s) => ((s.state = "partial_failed"), (s.completed_count = 0), (s.artifacts = [])),
    ],
    ["partial_cancelled with all completed", partial, (s) => (s.requested_count = 1)],
    [
      "active state with artifacts.length != completed_count",
      agentSnapshot,
      (s) => (s.completed_count = 1),
    ],
    ["terminal state without terminal_at_ms", snapshot, (s) => delete s.terminal_at_ms],
    ["terminal state with null terminal_at_ms", snapshot, (s) => (s.terminal_at_ms = null)],
    [
      "active state with terminal_at_ms",
      agentSnapshot,
      (s) => (s.terminal_at_ms = s.updated_at_ms),
    ],
    [
      "terminal_at_ms before created_at_ms",
      snapshot,
      (s) => (s.terminal_at_ms = s.created_at_ms - 1),
    ],
    [
      "terminal_at_ms after updated_at_ms",
      snapshot,
      (s) => (s.terminal_at_ms = s.updated_at_ms + 1),
    ],
    [
      "updated_at_ms before created_at_ms",
      agentSnapshot,
      (s) => (s.updated_at_ms = s.created_at_ms - 1),
    ],
    ["created_at_ms 0", agentSnapshot, (s) => (s.created_at_ms = 0)],
    [
      "artifact created before the job",
      snapshot,
      (s) => (s.artifacts[0].created_at_ms = s.created_at_ms - 1),
    ],
    [
      "artifact created after the job update",
      snapshot,
      (s) => (s.artifacts[0].created_at_ms = s.updated_at_ms + 1),
    ],
    ["safe_code on succeeded", snapshot, (s) => (s.safe_code = "image_native_failed")],
    ["non-succeeded terminal without safe_code", partial, (s) => delete s.safe_code],
    ["non-succeeded terminal with null safe_code", partial, (s) => (s.safe_code = null)],
    ["effective_quality auto", snapshot, (s) => (s.effective_quality = "auto")],
    ["unknown effective_model_id", snapshot, (s) => (s.effective_model_id = "other-model")],
    ["unaligned effective_width", snapshot, (s) => (s.effective_width = 500)],
  ];

  it.each(snapshotRejections)("snapshot rejects %s", (_name, base, mutate) => {
    expect(() => decodeImageJobSnapshot(mutated(base, mutate))).toThrow(ImageDecodeError);
  });

  it("snapshot accepts every valid state shape", () => {
    const accepted: Array<[Json, (s: Json) => void]> = [
      [agentSnapshot, terminalFailed],
      [
        agentSnapshot,
        (s) => (terminalFailed(s), (s.state = "cancelled"), (s.safe_code = "image_cancelled")),
      ],
      [partial, (s) => ((s.state = "partial_failed"), (s.safe_code = "image_native_failed"))],
      // Active job with partial progress: only completed <= requested and artifacts == completed.
      [partial, (s) => ((s.state = "running"), delete s.safe_code, delete s.terminal_at_ms)],
      // Rust has no safe_code rule for active states.
      [agentSnapshot, (s) => (s.safe_code = "image_busy")],
      // Window bounds are inclusive.
      [
        agentSnapshot,
        (s) => (
          terminalFailed(s),
          (s.updated_at_ms = s.created_at_ms),
          (s.terminal_at_ms = s.created_at_ms)
        ),
      ],
      [snapshot, (s) => (s.artifacts[0].created_at_ms = s.created_at_ms)],
      [snapshot, (s) => (s.artifacts[0].created_at_ms = s.updated_at_ms)],
      // Rust ImageJobSnapshot::validate does not require committed artifacts on success.
      [snapshot, (s) => (s.artifacts[0].state = "unavailable")],
    ];
    for (const [base, mutate] of accepted) {
      expect(() => decodeImageJobSnapshot(mutated(base, mutate))).not.toThrow();
    }
  });

  const resultRejections: Array<[string, Json, (r: Json) => void]> = [
    ["succeeded without artifacts", agentResult, (r) => (r.artifacts = [])],
    ["succeeded with completed < requested", agentResult, (r) => (r.requested_count = 3)],
    ["succeeded with safe_code", agentResult, (r) => (r.safe_code = "image_native_failed")],
    [
      "succeeded with unavailable artifact",
      agentResult,
      (r) => (r.artifacts[1].state = "unavailable"),
    ],
    [
      "succeeded with deleted artifact",
      agentResult,
      (r) => ((r.artifacts[0].state = "deleted"), (r.artifacts[0].byte_size = 0)),
    ],
    [
      "partial_failed with zero completed",
      partialResult,
      (r) => ((r.completed_count = 0), (r.artifacts = [])),
    ],
    ["partial_failed with all completed", partialResult, (r) => (r.requested_count = 1)],
    ["failed with completed artifacts", partialResult, (r) => (r.state = "failed")],
    ["non-succeeded without safe_code", partialResult, (r) => delete r.safe_code],
    ["non-succeeded with null safe_code", partialResult, (r) => (r.safe_code = null)],
    [
      "active state without safe_code",
      partialResult,
      (r) => ((r.state = "running"), delete r.safe_code),
    ],
    ["effective_quality auto", agentResult, (r) => (r.effective_quality = "auto")],
    ["unknown effective_model_id", agentResult, (r) => (r.effective_model_id = "other-model")],
    ["unaligned effective_height", agentResult, (r) => (r.effective_height = 500)],
  ];

  it.each(resultRejections)("result rejects %s", (_name, base, mutate) => {
    expect(() => decodeImageResult(mutated(base, mutate))).toThrow(ImageDecodeError);
  });

  it("result accepts active, partial and cancelled shapes carrying a safe_code", () => {
    for (const mutate of [
      (r: Json) => (r.state = "running"),
      (r: Json) => (r.state = "partial_cancelled"),
      (r: Json) => ((r.state = "cancelled"), (r.completed_count = 0), (r.artifacts = [])),
    ]) {
      expect(() => decodeImageResult(mutated(partialResult, mutate))).not.toThrow();
    }
  });

  it("failures name only the offending own path", () => {
    const message = (fn: () => unknown): string => {
      try {
        fn();
      } catch (error) {
        return (error as Error).message;
      }
      return "";
    };
    expect(
      message(() => decodeImageJobSnapshot(mutated(snapshot, (s) => delete s.terminal_at_ms)))
    ).toBe("Invalid image field: image_job.terminal_at_ms");
    expect(
      message(() =>
        decodeImageResult(mutated(agentResult, (r) => (r.artifacts[1].state = "deleted")))
      )
    ).toBe("Invalid image field: image_result.artifacts[1].state");
  });
});

describe("output dimension bounds (256..2048, 32-aligned, <= 2048x2048)", () => {
  const cases: Array<[number, boolean]> = [
    [0, false],
    [224, false], // aligned but below the minimum
    [255, false],
    [256, true],
    [257, false], // in range but unaligned
    [288, true],
    [500, false],
    [2048, true],
    [2049, false],
    [2080, false], // aligned but above the maximum
    [4096, false],
  ];
  const decodes = (fn: () => unknown): boolean => {
    try {
      fn();
      return true;
    } catch (error) {
      expect(error).toBeInstanceOf(ImageDecodeError);
      return false;
    }
  };

  it("exports constants mirroring Rust MIN/MAX/ALIGNMENT/MAX_PIXELS", () => {
    expect(IMAGE_OUTPUT_MIN_EDGE).toBe(256);
    expect(IMAGE_OUTPUT_MAX_EDGE).toBe(2048);
    expect(IMAGE_OUTPUT_DIMENSION_ALIGNMENT).toBe(32);
    expect(IMAGE_OUTPUT_MAX_PIXELS).toBe(4_194_304);
  });

  it.each(cases)("artifact edge %i accepted=%s", (edge, ok) => {
    for (const key of ["width", "height"]) {
      expect(
        decodes(() => decodeImageArtifactRef(mutated(committed, (a) => (a[key] = edge))))
      ).toBe(ok);
    }
  });

  it.each(cases)("job effective edge %i accepted=%s", (edge, ok) => {
    for (const key of ["effective_width", "effective_height"]) {
      expect(decodes(() => decodeImageJobSnapshot(mutated(snapshot, (s) => (s[key] = edge))))).toBe(
        ok
      );
    }
  });

  it.each(cases)("result effective edge %i accepted=%s", (edge, ok) => {
    for (const key of ["effective_width", "effective_height"]) {
      expect(decodes(() => decodeImageResult(mutated(result, (r) => (r[key] = edge))))).toBe(ok);
    }
  });

  it("accepts the area ceiling and rejects anything larger", () => {
    const both = (a: Json, w: number, h: number) => ((a.width = w), (a.height = h));
    expect(() =>
      decodeImageArtifactRef(mutated(committed, (a) => both(a, 2048, 2048)))
    ).not.toThrow();
    expect(() =>
      decodeImageArtifactRef(mutated(committed, (a) => both(a, 2048, 256)))
    ).not.toThrow();
    expect(() => decodeImageArtifactRef(mutated(committed, (a) => both(a, 2048, 2080)))).toThrow(
      ImageDecodeError
    );
    expect(() => decodeImageArtifactRef(mutated(committed, (a) => both(a, 4096, 4096)))).toThrow(
      ImageDecodeError
    );
  });
});

describe("isImageId", () => {
  it("accepts the Rust validate_id charset and length", () => {
    for (const ok of ["a", "A.b_c:d-9", "0", ".", "..", "x".repeat(128), "__proto__"]) {
      expect(isImageId(ok)).toBe(true);
    }
  });

  it("rejects empty, overlong, whitespace, separators, non-ASCII and non-strings", () => {
    for (const bad of [
      "",
      "x".repeat(129),
      "a b",
      "a/b",
      "a\\b",
      "a\n",
      "é",
      "a\u0000",
      1,
      null,
      undefined,
      {},
    ]) {
      expect(isImageId(bad)).toBe(false);
    }
  });

  it("is the barrel-exported guard used by the decoders", () => {
    expect(barrel.isImageId).toBe(isImageId);
  });
});

describe("ws hint decoding", () => {
  it("rejects forbidden payload fields", () => {
    for (const field of hints.forbidden_payload_fields as string[]) {
      expect(() =>
        decodeImageJobUpdatedEvent(mutated(jobHint, (f) => (f.payload[field] = "x")))
      ).toThrow(ImageDecodeError);
      expect(() =>
        decodeImageArtifactCommittedEvent(mutated(artifactHint, (f) => (f.payload[field] = "x")))
      ).toThrow(ImageDecodeError);
    }
  });

  it("rejects unknown frame keys, wrong version/type/event and missing scope", () => {
    expect(() => decodeImageJobUpdatedEvent(mutated(jobHint, (f) => (f.event_seq = 1)))).toThrow(
      ImageDecodeError
    );
    expect(() => decodeImageJobUpdatedEvent(mutated(jobHint, (f) => (f.version = "v2")))).toThrow(
      ImageDecodeError
    );
    expect(() => decodeImageJobUpdatedEvent(mutated(jobHint, (f) => delete f.version))).toThrow(
      ImageDecodeError
    );
    expect(() => decodeImageJobUpdatedEvent(mutated(jobHint, (f) => (f.type = "res")))).toThrow(
      ImageDecodeError
    );
    expect(() => decodeImageJobUpdatedEvent(artifactHint)).toThrow(ImageDecodeError);
    expect(() => decodeImageArtifactCommittedEvent(jobHint)).toThrow(ImageDecodeError);
    expect(() => decodeImageJobUpdatedEvent(mutated(jobHint, (f) => delete f.run_id))).toThrow(
      ImageDecodeError
    );
    expect(() =>
      decodeImageArtifactCommittedEvent(mutated(artifactHint, (f) => delete f.session_id))
    ).toThrow(ImageDecodeError);
  });

  it("requires payload scope to equal frame scope", () => {
    expect(() =>
      decodeImageJobUpdatedEvent(mutated(jobHint, (f) => (f.session_id = "other")))
    ).toThrow(ImageDecodeError);
    expect(() =>
      decodeImageJobUpdatedEvent(mutated(jobHint, (f) => (f.payload.run_id = "other")))
    ).toThrow(ImageDecodeError);
  });

  it("enforces payload value bounds", () => {
    const bad: Array<(p: Json) => void> = [
      (p) => (p.state = "queued"),
      (p) => (p.revision = 0),
      (p) => (p.requested_count = 0),
      (p) => (p.requested_count = 5),
      (p) => (p.completed_count = 3),
      (p) => (p.safe_code = "other"),
      (p) => (p.safe_code = null),
      (p) => delete p.job_id,
    ];
    for (const fn of bad) {
      expect(() => decodeImageJobUpdatedEvent(mutated(jobHint, (f) => fn(f.payload)))).toThrow(
        ImageDecodeError
      );
    }
    for (const fn of [
      (p: Json) => (p.ordinal = 4),
      (p: Json) => (p.state = "gone"),
      (p: Json) => (p.revision = 0),
      (p: Json) => delete p.artifact_id,
    ]) {
      expect(() =>
        decodeImageArtifactCommittedEvent(mutated(artifactHint, (f) => fn(f.payload)))
      ).toThrow(ImageDecodeError);
    }
  });

  it("rejects __proto__-style own keys at frame and payload level without polluting", () => {
    const raw = JSON.stringify(jobHint);
    const rawArtifact = JSON.stringify(artifactHint);
    const poison = '"__proto__":{"polluted":true},';
    const frames: Json[] = [
      JSON.parse(raw.replace(/^\{/, `{${poison}`)),
      JSON.parse(raw.replace('"payload":{', `"payload":{${poison}`)),
      JSON.parse(raw.replace(/^\{/, '{"constructor":{"prototype":{"polluted":true}},')),
    ];
    const artifactFrames: Json[] = [
      JSON.parse(rawArtifact.replace(/^\{/, `{${poison}`)),
      JSON.parse(rawArtifact.replace('"payload":{', `"payload":{${poison}`)),
    ];
    // JSON.parse creates a real own "__proto__" property (not a prototype swap).
    expect(Object.keys(frames[0])).toContain("__proto__");
    for (const frame of frames) {
      expect(() => decodeImageJobUpdatedEvent(frame)).toThrow(ImageDecodeError);
      expect(() => decodeImageHintWsEvent(frame)).toThrow(ImageDecodeError);
    }
    for (const frame of artifactFrames) {
      expect(() => decodeImageArtifactCommittedEvent(frame)).toThrow(ImageDecodeError);
      expect(() => decodeImageHintWsEvent(frame)).toThrow(ImageDecodeError);
    }
    try {
      decodeImageHintWsEvent(frames[0]);
    } catch (error) {
      expect((error as Error).message).not.toContain("__proto__");
    }
    expect(({} as Json).polluted).toBeUndefined();
  });

  it("treats __proto__-valued scope ids as plain strings", () => {
    const frame = mutated(jobHint, (f) => {
      f.session_id = "__proto__";
      f.run_id = "constructor";
      f.payload.session_id = "__proto__";
      f.payload.run_id = "constructor";
    });
    const decoded = decodeImageJobUpdatedEvent(frame);
    expect(decoded.session_id).toBe("__proto__");
    expect(Object.getPrototypeOf(decoded.payload)).toBe(Object.prototype);
    expect(({} as Json).session_id).toBeUndefined();
  });

  it("dispatches by event name", () => {
    expect(decodeImageHintWsEvent(jobHint).event).toBe("image_job.updated");
    expect(decodeImageHintWsEvent(artifactHint).event).toBe("image_artifact.committed");
    expect(() =>
      decodeImageHintWsEvent(mutated(jobHint, (f) => (f.event = "run.started")))
    ).toThrow(ImageDecodeError);
    expect(isImageHintEventName("image_job.updated")).toBe(true);
    expect(isImageHintEventName("image_artifact.committed")).toBe(true);
    expect(isImageHintEventName("chunk")).toBe(false);
    expect(isImageHintEventName(undefined)).toBe(false);
  });
});

describe("request validators", () => {
  const base = { template_id: "general-image", prompt: "A red fox", session_id: "session-1" };

  it("accepts minimal and full create bodies and returns a clean copy", () => {
    expect(validateImageJobCreateRequest(base)).toEqual(base);
    const full = {
      ...base,
      negative_prompt: "blurry",
      settings: { quality: "high", size: "512x384", seed: 2147483647, n: 4 },
    };
    expect(validateImageJobCreateRequest(full)).toEqual(full);
    expect(validateImageJobCreateRequest({ ...base, settings: {} }).settings).toEqual({});
    // undefined == absent (JSON.stringify drops it).
    expect(validateImageJobCreateRequest({ ...base, negative_prompt: undefined })).toEqual(base);
    expect(
      validateImageJobCreateRequest({ ...base, settings: { size: "wide", seed: 0, n: 1 } }).settings
    ).toEqual({
      size: "wide",
      seed: 0,
      n: 1,
    });
  });

  it("enforces prompt byte bounds in UTF-8", () => {
    expect(
      validateImageJobCreateRequest({ ...base, prompt: "a".repeat(8192) }).prompt
    ).toHaveLength(8192);
    expect(() => validateImageJobCreateRequest({ ...base, prompt: "a".repeat(8193) })).toThrow(
      ImageDecodeError
    );
    // 2731 * 3 bytes = 8193 > 8192 although only 2731 UTF-16 units.
    expect(() => validateImageJobCreateRequest({ ...base, prompt: "€".repeat(2731) })).toThrow(
      ImageDecodeError
    );
    expect(
      validateImageJobCreateRequest({ ...base, prompt: "€".repeat(2730) }).prompt
    ).toHaveLength(2730);
    expect(() => validateImageJobCreateRequest({ ...base, prompt: "" })).toThrow(ImageDecodeError);
    expect(() => validateImageJobCreateRequest({ ...base, prompt: "a\u0000b" })).toThrow(
      ImageDecodeError
    );
    expect(
      validateImageJobCreateRequest({ ...base, negative_prompt: "n".repeat(2048) }).negative_prompt
    ).toHaveLength(2048);
    expect(() =>
      validateImageJobCreateRequest({ ...base, negative_prompt: "n".repeat(2049) })
    ).toThrow(ImageDecodeError);
    expect(() => validateImageJobCreateRequest({ ...base, negative_prompt: "" })).toThrow(
      ImageDecodeError
    );
  });

  it("enforces key sets, ids and settings bounds", () => {
    const bad: unknown[] = [
      { ...base, extra: 1 },
      { ...base, namespace: "x" },
      { prompt: "p", session_id: "s" },
      { ...base, session_id: "a b" },
      { ...base, template_id: "" },
      { ...base, settings: { extra: 1 } },
      { ...base, settings: { n: 0 } },
      { ...base, settings: { n: 5 } },
      { ...base, settings: { n: 1.5 } },
      { ...base, settings: { seed: -1 } },
      { ...base, settings: { seed: 2147483648 } },
      { ...base, settings: { quality: "ultra" } },
      { ...base, settings: { size: "100x100" } },
      { ...base, settings: { size: "2048x2049" } },
      { ...base, settings: { size: "512X512" } },
      { ...base, settings: null },
      null,
      [],
    ];
    for (const body of bad)
      expect(() => validateImageJobCreateRequest(body)).toThrow(ImageDecodeError);
  });

  it("validates cancel requests (expected_revision >= 1)", () => {
    const ok = { session_id: "s1", run_id: "r1", expected_revision: 3 };
    expect(validateImageJobCancelRequest(ok)).toEqual(ok);
    for (const body of [
      { ...ok, expected_revision: 0 },
      { ...ok, expected_revision: 1.5 },
      { ...ok, expected_revision: "3" },
      { ...ok, extra: 1 },
      { session_id: "s1", run_id: "r1" },
      { ...ok, run_id: "r/1" },
    ]) {
      expect(() => validateImageJobCancelRequest(body)).toThrow(ImageDecodeError);
    }
  });
});

describe("capability helpers", () => {
  const readers = { image_artifacts: true, image_artifacts_version: "image_artifacts.v1" };
  const generation = { local_image: true, local_image_version: "local_image.v1" };

  it("imageReadersAvailable truth table", () => {
    expect(imageReadersAvailable(readers)).toBe(true);
    expect(imageReadersAvailable({ ...readers, ...generation })).toBe(true);
    for (const caps of [
      undefined,
      null,
      {},
      generation,
      { image_artifacts: true },
      { image_artifacts_version: "image_artifacts.v1" },
      { image_artifacts: false, image_artifacts_version: "image_artifacts.v1" },
      { image_artifacts: true, image_artifacts_version: "image_artifacts.v2" },
      { image_artifacts: true, image_artifacts_version: "local_image.v1" },
      {
        image_artifacts: "true" as unknown as boolean,
        image_artifacts_version: "image_artifacts.v1",
      },
    ]) {
      expect(imageReadersAvailable(caps)).toBe(false);
    }
  });

  it("imageGenerationAvailable truth table and independence", () => {
    expect(imageGenerationAvailable(generation)).toBe(true);
    expect(imageGenerationAvailable({ ...readers, ...generation })).toBe(true);
    for (const caps of [
      undefined,
      null,
      {},
      readers,
      { local_image: true },
      { local_image_version: "local_image.v1" },
      { local_image: false, local_image_version: "local_image.v1" },
      { local_image: true, local_image_version: "local_image.v2" },
      { local_image: true, local_image_version: "image_artifacts.v1" },
    ]) {
      expect(imageGenerationAvailable(caps)).toBe(false);
    }
    // Phase 06 backend shape: readers on, generation unadvertised.
    expect(imageReadersAvailable(fixture.gateway_capabilities.phase_06_advertised)).toBe(true);
    expect(imageGenerationAvailable(fixture.gateway_capabilities.phase_06_advertised)).toBe(false);
  });
});

describe("shared barrel", () => {
  it("exports image decoders and helpers", () => {
    for (const name of [
      "decodeImageJobSnapshot",
      "decodeImageHintWsEvent",
      "validateImageJobCreateRequest",
      "imageReadersAvailable",
      "imageGenerationAvailable",
      "ImageDecodeError",
    ]) {
      expect((barrel as Record<string, unknown>)[name]).toBeTypeOf("function");
    }
  });
});
