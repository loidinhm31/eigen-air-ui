import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactAdapterError } from "../factory/interfaces/IArtifactAdapter.js";
import {
  isValidExpectedPng,
  readBoundedBytes,
  readVerifiedPng,
  type ExpectedPng,
} from "./artifact-bytes.js";
import {
  PNG_256,
  PNG_256_SHA256,
  pngResponse,
  probedStream,
  sha256Hex,
  type StreamProbe,
} from "./artifact-test-support.js";

const expected: ExpectedPng = {
  byteSize: PNG_256.byteLength,
  sha256: PNG_256_SHA256,
  width: 256,
  height: 256,
};

function probe(): StreamProbe {
  return { pulled: 0, cancelled: false };
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

function chunked(bytes: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.byteLength; i += size) out.push(bytes.slice(i, i + size));
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isValidExpectedPng", () => {
  it("accepts the contract output envelope: edge 256..2048, 32-aligned, <= 4 Mpx", () => {
    for (const [width, height] of [
      [256, 256],
      [2048, 2048],
      [256, 2048],
      [2048, 256],
      [512, 768],
    ] as const) {
      expect(isValidExpectedPng({ ...expected, width, height })).toBe(true);
    }
  });

  it("rejects out-of-envelope, unaligned and non-integer dimensions", () => {
    for (const [width, height] of [
      [255, 256],
      [256, 224],
      [1, 1],
      [0, 256],
      [2080, 256],
      [8192, 8192],
      [4096, 1024],
      [257, 256],
      [256, 300],
      [256.5, 256],
      [Number.NaN, 256],
    ] as const) {
      expect(isValidExpectedPng({ ...expected, width, height })).toBe(false);
    }
  });

  it("returns false (never throws) for runtime-malformed metadata", () => {
    const bad = (patch: Record<string, unknown>) =>
      isValidExpectedPng({ ...expected, ...patch } as unknown as ExpectedPng);
    expect(bad({ sha256: undefined })).toBe(false);
    expect(bad({ sha256: 7 })).toBe(false);
    expect(bad({ sha256: null })).toBe(false);
    expect(bad({ width: "256" })).toBe(false);
    expect(bad({ byteSize: "141" })).toBe(false);
    expect(bad({ byteSize: 0 })).toBe(false);
    expect(isValidExpectedPng(undefined as unknown as ExpectedPng)).toBe(false);
  });
});

describe("readVerifiedPng", () => {
  it("returns an image/png Blob with the exact bytes for a verified multi-chunk body", async () => {
    const p = probe();
    const response = pngResponse(probedStream(chunked(PNG_256, 10), p), {
      "Content-Length": String(PNG_256.byteLength),
    });
    const blob = await readVerifiedPng(response, expected);
    expect(blob.type).toBe("image/png");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PNG_256);
  });

  it("accepts media type parameters, uppercase sha, and a missing Content-Length", async () => {
    const response = pngResponse(new Blob([PNG_256]).stream(), {
      "Content-Type": "Image/PNG; charset=binary",
    });
    const blob = await readVerifiedPng(response, {
      ...expected,
      sha256: expected.sha256.toUpperCase(),
    });
    expect(blob.size).toBe(PNG_256.byteLength);
  });

  it("rejects a wrong sha256 as integrity", async () => {
    const error = await failureOf(
      readVerifiedPng(pngResponse(new Blob([PNG_256]).stream()), {
        ...expected,
        sha256: "0".repeat(64),
      })
    );
    expect(error.kind).toBe("integrity");
  });

  it("rejects mismatching IHDR width or height as integrity", async () => {
    for (const dims of [
      { width: 288, height: 256 },
      { width: 256, height: 288 },
    ]) {
      const error = await failureOf(
        readVerifiedPng(pngResponse(new Blob([PNG_256]).stream()), { ...expected, ...dims })
      );
      expect(error.kind).toBe("integrity");
    }
  });

  it("rejects a bad PNG signature or IHDR marker even with a matching hash", async () => {
    for (const index of [0, 12]) {
      const bad = PNG_256.slice();
      bad[index] = (bad[index] ?? 0) ^ 0xff;
      const error = await failureOf(
        readVerifiedPng(pngResponse(new Blob([bad]).stream()), {
          ...expected,
          sha256: await sha256Hex(bad),
        })
      );
      expect(error.kind).toBe("integrity");
    }
  });

  it("rejects non-image/png media types", async () => {
    for (const type of ["image/jpeg", "image/png+xml", "text/plain", ""]) {
      const p = probe();
      const response = pngResponse(probedStream([PNG_256], p), { "Content-Type": type });
      const error = await failureOf(readVerifiedPng(response, expected));
      expect(error.kind).toBe("integrity");
      expect(p.pulled).toBe(0);
    }
  });

  it("rejects Content-Length mismatch before reading and cancels the body", async () => {
    const p = probe();
    const response = pngResponse(probedStream([PNG_256], p), {
      "Content-Length": String(PNG_256.byteLength + 1),
    });
    const error = await failureOf(readVerifiedPng(response, expected));
    expect(error.kind).toBe("integrity");
    expect(p.cancelled).toBe(true);
  });

  it("rejects over-max and malformed Content-Length", async () => {
    const over = await failureOf(
      readVerifiedPng(
        pngResponse(null, { "Content-Length": String(16 * 1024 * 1024 + 1) }),
        expected
      )
    );
    expect(over.kind).toBe("too_large");
    const junk = await failureOf(
      readVerifiedPng(pngResponse(null, { "Content-Length": "12abc" }), expected)
    );
    expect(junk.kind).toBe("integrity");
  });

  it("aborts an oversize stream at byteSize+1 and cancels the reader", async () => {
    const p = probe();
    const chunks = [
      ...chunked(PNG_256, 20),
      new Uint8Array(1),
      ...Array.from({ length: 1000 }, () => new Uint8Array(1024)),
    ];
    const error = await failureOf(readVerifiedPng(pngResponse(probedStream(chunks, p)), expected));
    expect(error.kind).toBe("too_large");
    expect(p.cancelled).toBe(true);
    expect(p.pulled).toBeLessThan(chunked(PNG_256, 20).length + 5);
  });

  it("rejects a short body and an empty body as integrity", async () => {
    const short = await failureOf(
      readVerifiedPng(pngResponse(new Blob([PNG_256.slice(0, 30)]).stream()), expected)
    );
    expect(short.kind).toBe("integrity");
    const none = await failureOf(readVerifiedPng(pngResponse(null), expected));
    expect(none.kind).toBe("integrity");
  });

  it("rejects invalid expected metadata before reading", async () => {
    const p = probe();
    const error = await failureOf(
      readVerifiedPng(pngResponse(probedStream([PNG_256], p)), {
        ...expected,
        byteSize: 16 * 1024 * 1024 + 1,
      })
    );
    expect(error.kind).toBe("invalid_request");
    expect(p.cancelled).toBe(true);
  });

  it("rejects metadata outside the output envelope and non-string sha as invalid_request", async () => {
    for (const patch of [
      { width: 1, height: 1 },
      { width: 4096, height: 1024 },
      { width: 257 },
      { sha256: 42 as unknown as string },
    ]) {
      const p = probe();
      const error = await failureOf(
        readVerifiedPng(pngResponse(probedStream([PNG_256], p)), { ...expected, ...patch })
      );
      expect(error.kind).toBe("invalid_request");
      expect(p.cancelled).toBe(true);
      expect(p.pulled).toBe(0);
    }
  });

  it("fails closed with `unsupported` when crypto.subtle is missing, returning no bytes", async () => {
    for (const stub of [{}, undefined]) {
      vi.stubGlobal("crypto", stub);
      const p = probe();
      const error = await failureOf(
        readVerifiedPng(pngResponse(probedStream([PNG_256], p)), expected)
      );
      expect(error.kind).toBe("unsupported");
      expect(error.message).toBe("artifact_adapter_unsupported");
      expect(p.pulled).toBe(0);
      expect(p.cancelled).toBe(true);
    }
  });

  it("maps an abort during the read to aborted and cancels the reader", async () => {
    const p = probe();
    const controller = new AbortController();
    const pending = readVerifiedPng(
      pngResponse(probedStream([PNG_256.slice(0, 10)], p, { hang: true })),
      expected,
      controller.signal
    );
    controller.abort();
    const error = await failureOf(pending);
    expect(error.kind).toBe("aborted");
    expect(p.cancelled).toBe(true);
  });

  it("maps a stream error to network", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("boom"));
      },
    });
    const error = await failureOf(readVerifiedPng(pngResponse(stream), expected));
    expect(error.kind).toBe("network");
  });
});

describe("readBoundedBytes", () => {
  it("returns undefined and cancels when the body exceeds the bound", async () => {
    const p = probe();
    const chunks = Array.from({ length: 100 }, () => new Uint8Array(100));
    const result = await readBoundedBytes(new Response(probedStream(chunks, p)), 250);
    expect(result).toBeUndefined();
    expect(p.cancelled).toBe(true);
    expect(p.pulled).toBeLessThan(10);
  });

  it("concatenates chunks within the bound", async () => {
    const result = await readBoundedBytes(new Response("hello world"), 64);
    expect(new TextDecoder().decode(result)).toBe("hello world");
  });
});
