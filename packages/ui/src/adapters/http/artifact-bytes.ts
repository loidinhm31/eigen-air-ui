// Bounded streaming readers for the local-image REST adapter: JSON/error bodies and
// verified PNG artifact bytes. No partial result is ever returned; the reader is cancelled
// on every failure path.
import {
  IMAGE_MAX_BYTE_SIZE,
  IMAGE_OUTPUT_DIMENSION_ALIGNMENT,
  IMAGE_OUTPUT_MAX_EDGE,
  IMAGE_OUTPUT_MAX_PIXELS,
  IMAGE_OUTPUT_MIN_EDGE,
} from "@eigen-air-ui/shared/types";
import { ArtifactAdapterError } from "../factory/interfaces/IArtifactAdapter.js";

export interface ExpectedPng {
  byteSize: number;
  /** 64 hex chars, case-insensitive. */
  sha256: string;
  width: number;
  height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** signature(8) + IHDR length(4) + "IHDR"(4) + width(4) + height(4). */
const PNG_HEADER_BYTES = 24;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function cancelQuietly(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  void reader.cancel().catch(() => undefined);
}

/** Maps a failure raised while reading the body to `aborted` (our signal) or `network`. */
function streamFailure(signal: AbortSignal | undefined): ArtifactAdapterError {
  return new ArtifactAdapterError(signal?.aborted ? "aborted" : "network");
}

/** Discards an unread response body (best effort). */
export function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

/**
 * Reads at most `maxBytes` of the body. Returns `undefined` (and cancels the stream) when the
 * body is larger. A missing body is an empty result.
 */
export async function readBoundedBytes(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal
): Promise<Uint8Array | undefined> {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const onAbort = () => cancelQuietly(reader);
  signal?.addEventListener("abort", onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw new ArtifactAdapterError("aborted");
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new ArtifactAdapterError("aborted");
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        cancelQuietly(reader);
        return undefined;
      }
      chunks.push(value);
    }
  } catch (error) {
    cancelQuietly(reader);
    throw error instanceof ArtifactAdapterError ? error : streamFailure(signal);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Output-artifact metadata bounds, mirroring Rust `ImageArtifactRef::validate`
 * (`src/local_image/request.rs` 953-975): edge 256..2048, multiples of 32, area <= 4 Mpx.
 * Never throws: runtime-malformed input (non-string sha, non-number dims) is just invalid.
 */
export function isValidExpectedPng(expected: ExpectedPng): boolean {
  const dim = (v: unknown): v is number =>
    typeof v === "number" &&
    Number.isSafeInteger(v) &&
    v >= IMAGE_OUTPUT_MIN_EDGE &&
    v <= IMAGE_OUTPUT_MAX_EDGE &&
    v % IMAGE_OUTPUT_DIMENSION_ALIGNMENT === 0;
  const { byteSize, sha256, width, height } = (expected ?? {}) as Partial<ExpectedPng>;
  return (
    typeof byteSize === "number" &&
    Number.isSafeInteger(byteSize) &&
    byteSize >= 1 &&
    byteSize <= IMAGE_MAX_BYTE_SIZE &&
    typeof sha256 === "string" &&
    SHA256_HEX.test(sha256.toLowerCase()) &&
    dim(width) &&
    dim(height) &&
    width * height <= IMAGE_OUTPUT_MAX_PIXELS
  );
}

/** Early header checks. `Content-Length` is only a hint; the stream count is authoritative. */
function checkHeaders(response: Response, expected: ExpectedPng): void {
  const contentType = (response.headers.get("Content-Type") ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "image/png") {
    throw new ArtifactAdapterError("integrity");
  }
  const length = response.headers.get("Content-Length");
  if (length === null) return;
  if (!/^\d{1,16}$/.test(length.trim())) throw new ArtifactAdapterError("integrity");
  const parsed = Number(length.trim());
  if (parsed > IMAGE_MAX_BYTE_SIZE) throw new ArtifactAdapterError("too_large");
  if (parsed !== expected.byteSize) throw new ArtifactAdapterError("integrity");
}

function checkPngHeader(bytes: Uint8Array, expected: ExpectedPng): void {
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new ArtifactAdapterError("integrity");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, PNG_HEADER_BYTES);
  const isIhdr =
    view.getUint32(8) === 13 &&
    bytes[12] === 0x49 &&
    bytes[13] === 0x48 &&
    bytes[14] === 0x44 &&
    bytes[15] === 0x52;
  if (!isIhdr) throw new ArtifactAdapterError("integrity");
  if (view.getUint32(16) !== expected.width || view.getUint32(20) !== expected.height) {
    throw new ArtifactAdapterError("integrity");
  }
}

/** SubtleCrypto is secure-context only; without it nothing can be verified, so nothing is returned. */
function requireSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new ArtifactAdapterError("unsupported");
  return subtle;
}

async function sha256Hex(subtle: SubtleCrypto, bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Streams an artifact response into a verified `image/png` Blob.
 *
 * Verification: media type exactly `image/png`; `Content-Length` (hint) equals `byteSize`;
 * stream aborted at `byteSize + 1`; PNG signature + first-chunk IHDR dimensions equal the
 * metadata; SHA-256 of the complete body equals `sha256`. Any failure rejects with
 * `integrity` / `too_large` / `aborted` / `network`; nothing partial escapes. Without
 * `crypto.subtle` (insecure context) it rejects `unsupported` before reading any byte.
 */
export async function readVerifiedPng(
  response: Response,
  expected: ExpectedPng,
  signal?: AbortSignal
): Promise<Blob> {
  if (!isValidExpectedPng(expected)) {
    discardBody(response);
    throw new ArtifactAdapterError("invalid_request");
  }
  let subtle: SubtleCrypto;
  try {
    subtle = requireSubtle();
    checkHeaders(response, expected);
  } catch (error) {
    discardBody(response);
    throw error;
  }
  if (!response.body) throw new ArtifactAdapterError("integrity");

  const reader = response.body.getReader();
  const onAbort = () => cancelQuietly(reader);
  signal?.addEventListener("abort", onAbort, { once: true });
  // `byteSize` is validated <= 16 MiB, so this is the bounded destination buffer.
  const buffer = new Uint8Array(expected.byteSize);
  let total = 0;
  let headerChecked = false;
  try {
    for (;;) {
      if (signal?.aborted) throw new ArtifactAdapterError("aborted");
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new ArtifactAdapterError("aborted");
      if (done) break;
      // Overflow is detected at byteSize + 1 without copying the excess.
      if (total + value.byteLength > expected.byteSize) throw new ArtifactAdapterError("too_large");
      buffer.set(value, total);
      total += value.byteLength;
      if (!headerChecked && total >= PNG_HEADER_BYTES) {
        checkPngHeader(buffer, expected);
        headerChecked = true;
      }
    }
    if (total !== expected.byteSize || !headerChecked) throw new ArtifactAdapterError("integrity");
    const actual = await sha256Hex(subtle, buffer);
    if (signal?.aborted) throw new ArtifactAdapterError("aborted");
    if (actual !== expected.sha256.toLowerCase()) throw new ArtifactAdapterError("integrity");
    return new Blob([buffer], { type: "image/png" });
  } catch (error) {
    cancelQuietly(reader);
    throw error instanceof ArtifactAdapterError ? error : streamFailure(signal);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
