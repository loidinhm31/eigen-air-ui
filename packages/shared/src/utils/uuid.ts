/**
 * Generates an RFC 4122 v4 UUID using standard Web Crypto.
 *
 * In secure contexts (HTTPS, localhost), prefers native `crypto.randomUUID()`.
 * In non-secure contexts (e.g. LAN / Tailscale HTTP origins like http://100.x.y.z:18790),
 * `crypto.randomUUID` is omitted by browsers per W3C specification while
 * `crypto.getRandomValues()` remains available.
 *
 * Throws when Web Crypto is unavailable to preserve mutation collision resistance.
 */
export function safeRandomUUID(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  if (typeof webCrypto?.getRandomValues !== "function") {
    throw new Error("Web Crypto API unavailable");
  }

  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
