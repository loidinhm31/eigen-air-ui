import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Drift guard only. Decoder/vector behavior lives in
// `src/types/artifact-decoder.test.ts`, which reads the F-local copy. This file
// asserts that the F-local copy is byte-identical to the backend-generated
// fixture, so a backend revision cannot leave the frontend on stale vectors.

const FIXTURE_RELATIVE_PATH = "test-fixtures/contracts/local-image-v1.json";

function resolveBackendRoot(): string | null {
  if (process.env.EIGEN_AIR_DIR) {
    return resolve(process.env.EIGEN_AIR_DIR);
  }
  const testDir =
    typeof __dirname !== "undefined" ? __dirname : fileURLToPath(new URL(".", import.meta.url));
  const direct = [
    resolve(testDir, "../../../../../eigen-air"),
    resolve(process.cwd(), "../../../eigen-air"),
  ];
  for (const candidate of direct) {
    if (existsSync(join(candidate, "Cargo.toml"))) return candidate;
  }
  for (const root of [resolve(testDir, "../../../../../.."), resolve(process.cwd(), "../../..")]) {
    if (!existsSync(root)) continue;
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const manifest = join(root, entry.name, "Cargo.toml");
        if (existsSync(manifest) && readFileSync(manifest, "utf8").includes('name = "eigen-air"')) {
          return join(root, entry.name);
        }
      }
    } catch {
      // Unreadable search root: treat as not discoverable.
    }
  }
  return null;
}

const backendRoot = resolveBackendRoot();
const backendFixtureCandidate = backendRoot ? join(backendRoot, FIXTURE_RELATIVE_PATH) : null;
const frontendFixture = resolve(
  typeof __dirname !== "undefined" ? __dirname : fileURLToPath(new URL(".", import.meta.url)),
  "../../..",
  FIXTURE_RELATIVE_PATH
);

// An explicit EIGEN_AIR_DIR is always compared (a wrong path must fail, never skip); only an
// undiscoverable sibling checkout (EIGEN_AIR_DIR unset) skips the comparison.
const backendFixture =
  process.env.EIGEN_AIR_DIR ||
  (backendFixtureCandidate !== null && existsSync(backendFixtureCandidate))
    ? backendFixtureCandidate
    : null;

describe("local_image_fixture.v1 frontend copy", () => {
  if (backendFixture === null) {
    it.skip("is byte-identical to the backend-generated fixture (backend checkout not discoverable)", () => {});
    return;
  }
  it("is byte-identical to the backend-generated fixture", () => {
    expect(
      existsSync(backendFixture),
      `EIGEN_AIR_DIR is set but the backend fixture is missing: expected ${backendFixture}; point EIGEN_AIR_DIR at the eigen-air checkout root`
    ).toBe(true);
    const backendBytes = readFileSync(backendFixture);
    const frontendBytes = readFileSync(frontendFixture);
    const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    expect(
      digest(frontendBytes),
      "F test-fixtures/contracts/local-image-v1.json drifted from backend; refresh the copy and its digest pin in artifact-decoder.test.ts"
    ).toBe(digest(backendBytes));
  });
});
