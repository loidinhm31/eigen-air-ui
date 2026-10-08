// Shared test helpers for the artifact adapter suites (test-only; not imported by production code).
// Wire literals mirror test-fixtures/contracts/local-image-v1.json vectors (strict decoders accept them).

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

/** Real 256x256 8-bit grayscale PNG (smallest output size the contract allows; 141 bytes). */
export const PNG_256 = fromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAAAAAB5Gfe6AAAAVElEQVR42u3BAQEAAACAkP6v7ggKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGAEPAAEccgnDAAAAAElFTkSuQmCC"
);
export const PNG_256_SHA256 = "f818a2fa866dbd2bd5b408508cc24539a1b579787aaf5bd408ffb684383ccef1";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const BASE_URL = "http://daemon.test:18790";
export const TOKEN = "sentinel-token-123";

export const committedArtifact: Record<string, unknown> = {
  schema: "image_artifact.v1",
  artifact_id: "10000000-0000-4000-8000-000000000001",
  job_id: "00000000-0000-4000-8000-000000000001",
  session_id: "session-synth-001",
  run_id: "run-synth-001",
  ordinal: 0,
  mime: "image/png",
  width: 512,
  height: 512,
  byte_size: 1048576,
  sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  created_at_ms: 1700000001000,
  state: "committed",
  tool_call_id: "call_synth_agent_001",
};

export const runningSnapshot: Record<string, unknown> = {
  schema: "image_job.v1",
  job_id: "00000000-0000-4000-8000-000000000001",
  session_id: "session-synth-001",
  run_id: "run-synth-001",
  origin: "agent_tool",
  tool_call_id: "call_synth_agent_001",
  state: "running",
  revision: 3,
  requested_count: 2,
  completed_count: 0,
  effective_quality: "high",
  effective_width: 384,
  effective_height: 512,
  effective_steps: 28,
  effective_backend: "vulkan",
  effective_model_id: "qwen-image-2.1",
  safe_code: null,
  created_at_ms: 1700000000000,
  updated_at_ms: 1700000001500,
  terminal_at_ms: null,
  artifacts: [],
};

export const directSnapshot: Record<string, unknown> = {
  ...runningSnapshot,
  job_id: "00000000-0000-4000-8000-000000000002",
  session_id: "session-synth-002",
  run_id: "run-synth-002",
  origin: "direct_template",
  template_id: "general-image",
  tool_call_id: undefined,
  state: "admitted",
  revision: 1,
  requested_count: 1,
};

export const templateList: Record<string, unknown> = {
  schema: "image_template_list.v1",
  revision: 1,
  templates: [
    {
      id: "general-image",
      name: "General Image",
      description: "General-purpose image generation.",
      editable_fields: ["prompt", "negative_prompt", "quality", "size", "seed", "n"],
      defaults: { quality: "balanced", size: "square", n: 1 },
    },
  ],
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface StreamProbe {
  pulled: number;
  cancelled: boolean;
}

/** Pull-based stream so tests can observe how much was consumed and whether it was cancelled. */
export function probedStream(
  chunks: Uint8Array[],
  probe: StreamProbe,
  options: { hang?: boolean } = {}
): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      if (chunk) {
        index += 1;
        probe.pulled += 1;
        controller.enqueue(chunk);
        return undefined;
      }
      if (options.hang) return new Promise<void>(() => undefined);
      controller.close();
      return undefined;
    },
    cancel() {
      probe.cancelled = true;
    },
  });
}

export function pngResponse(
  body: BodyInit | null,
  headers: Record<string, string> = {},
  status = 200
): Response {
  return new Response(body, { status, headers: { "Content-Type": "image/png", ...headers } });
}
