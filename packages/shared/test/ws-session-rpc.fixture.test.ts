import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeWsInbound } from "../src/types/user-question-decoder.js";

function resolveBackendRoot(): string {
  if (process.env.EIGEN_AIR_DIR) {
    return resolve(process.env.EIGEN_AIR_DIR);
  }
  const testDir =
    typeof __dirname !== "undefined"
      ? __dirname
      : fileURLToPath(new URL(".", import.meta.url));
  const candidateDirect = [
    resolve(testDir, "../../../.."),
    resolve(testDir, "../../.."),
    resolve(testDir, "../../../eigen-air"),
    resolve(testDir, "../../../../../eigen-air"),
    resolve(process.cwd(), ".."),
    resolve(process.cwd(), "../.."),
  ];
  for (const c of candidateDirect) {
    if (existsSync(join(c, "Cargo.toml"))) return c;
  }
  const searchRoots = [
    resolve(testDir, "../../../../../.."),
    resolve(process.cwd(), "../../.."),
  ];
  for (const root of searchRoots) {
    if (existsSync(root)) {
      try {
        const entries = readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const manifest = join(root, entry.name, "Cargo.toml");
            if (existsSync(manifest)) {
              const content = readFileSync(manifest, "utf8");
              if (content.includes('name = "eigen-air"')) {
                return join(root, entry.name);
              }
            }
          }
        }
      } catch {}
    }
  }
  return resolve(testDir, "../../../..");
}

const backendRoot = resolveBackendRoot();
const fixturePath = join(backendRoot, "test-fixtures/contracts/ws-session-rpc-v1.json");
const fixtureBytes = readFileSync(fixturePath);
const fixture = JSON.parse(fixtureBytes.toString("utf8")) as {
  schema: string;
  frames: Record<string, unknown>;
};

describe("Rust-generated WS session RPC contract fixture handoff", () => {
  it("pins the backend-generated contract bytes without copying them into the sibling", () => {
    expect(createHash("sha256").update(fixtureBytes).digest("hex")).toBe(
      "2094fa44d89094f64c3bf7811bceedf94b80a115191217ba5efe2d3bce9ff2e1"
    );
    expect(fixture.schema).toBe("eigen-air.ws-session-rpc-v1");
  });

  it("decodes every frame via decodeWsInbound and validates error envelopes", () => {
    const frameEntries = Object.entries(fixture.frames);
    expect(frameEntries.length).toBeGreaterThan(0);

    for (const [key, frameObj] of frameEntries) {
      const raw = JSON.stringify(frameObj);
      const decoded = decodeWsInbound(raw);
      expect(decoded.kind, `Frame ${key} failed to decode`).toBe("frame");

      if (decoded.kind === "frame") {
        expect(decoded.frame.type).toBe("res");
        const res = decoded.frame;
        if (!res.ok) {
          expect(res.error).toBeDefined();
          expect(res.error?.code).toBeTruthy();
          expect(res.error?.request_id).toBe(res.id);
        } else {
          expect(res.data).toBeDefined();
        }
      }
    }
  });

  it("specifically accepts get and list response data shapes", () => {
    const getOk = decodeWsInbound(JSON.stringify(fixture.frames.sessions_get_ok));
    expect(getOk.kind).toBe("frame");
    if (getOk.kind === "frame" && getOk.frame.ok) {
      const data = getOk.frame.data;
      expect(data && typeof data === "object" && "session" in data).toBe(true);
      if (data && typeof data === "object" && "session" in data) {
        const session = data.session;
        expect(session && typeof session === "object" && "id" in session).toBe(true);
        if (session && typeof session === "object" && "id" in session) {
          expect(session.id).toBe("sess-0001");
        }
      }
    }

    const listPage = decodeWsInbound(JSON.stringify(fixture.frames.sessions_list_page));
    expect(listPage.kind).toBe("frame");
    if (listPage.kind === "frame" && listPage.frame.ok) {
      const data = listPage.frame.data;
      expect(data && typeof data === "object" && "sessions" in data && "next_cursor" in data).toBe(true);
      if (data && typeof data === "object" && "sessions" in data && "next_cursor" in data) {
        expect(Array.isArray(data.sessions)).toBe(true);
        expect(typeof data.next_cursor).toBe("string");
      }
    }

    const lastPage = decodeWsInbound(JSON.stringify(fixture.frames.sessions_list_last_page));
    expect(lastPage.kind).toBe("frame");
    if (lastPage.kind === "frame" && lastPage.frame.ok) {
      const data = lastPage.frame.data;
      expect(data && typeof data === "object" && "sessions" in data && "next_cursor" in data).toBe(true);
      if (data && typeof data === "object" && "sessions" in data && "next_cursor" in data) {
        expect(Array.isArray(data.sessions)).toBe(true);
        expect(data.next_cursor).toBeNull();
      }
    }
  });
});
