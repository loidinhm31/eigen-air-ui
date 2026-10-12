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

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * Pure-TypeScript FIPS 180-4 SHA-256 digest used only when `crypto.subtle` is unavailable
 * (for example, LAN HTTP origins such as `http://100.91.26.60:25001`). Note: hashing over HTTP
 * verifies payload consistency against the fetched metadata, not transport authenticity.
 */
export function sha256FallbackHex(bytes: Uint8Array): string {
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const len = bytes.byteLength;
  const bitLenHi = Math.floor(len / 0x20000000);
  const bitLenLo = (len << 3) >>> 0;
  const paddedLen = (len + 9 + 63) & ~63;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLenHi, false);
  view.setUint32(paddedLen - 4, bitLenLo, false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const v15 = w[i - 15]!;
      const s0 = ((v15 >>> 7) | (v15 << 25)) ^ ((v15 >>> 18) | (v15 << 14)) ^ (v15 >>> 3);
      const v2 = w[i - 2]!;
      const s1 = ((v2 >>> 17) | (v2 << 15)) ^ ((v2 >>> 19) | (v2 << 13)) ^ (v2 >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => (word >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof subtle.digest === "function") {
    const digest = new Uint8Array(await subtle.digest("SHA-256", bytes as BufferSource));
    return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return sha256FallbackHex(bytes);
}

/**
 * Streams an artifact response into a verified `image/png` Blob.
 *
 * Verification: media type exactly `image/png`; `Content-Length` (hint) equals `byteSize`;
 * stream aborted at `byteSize + 1`; PNG signature + first-chunk IHDR dimensions equal the
 * metadata; SHA-256 of the complete body equals `sha256` (using WebCrypto when available or
 * the pure-TS FIPS 180-4 fallback on non-HTTPS LAN origins). Any failure rejects with
 * `integrity` / `too_large` / `aborted` / `network`; nothing partial escapes.
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
  try {
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
    const actual = await sha256Hex(buffer);
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
