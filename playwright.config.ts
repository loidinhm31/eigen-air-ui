import { defineConfig } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

function resolveBackendDir(): string {
  if (process.env.EIGEN_AIR_DIR) {
    return resolve(process.env.EIGEN_AIR_DIR);
  }
  const directCandidate = resolve("../../../eigen-air");
  if (existsSync(join(directCandidate, "Cargo.toml"))) {
    return directCandidate;
  }
  const workspaceRoot = resolve("../../..");
  if (existsSync(workspaceRoot)) {
    try {
      const entries = readdirSync(workspaceRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const manifest = join(workspaceRoot, entry.name, "Cargo.toml");
          if (existsSync(manifest)) {
            const content = readFileSync(manifest, "utf8");
            if (content.includes('name = "eigen-air"')) {
              return join(workspaceRoot, entry.name);
            }
          }
        }
      }
    } catch {}
  }
  return directCandidate;
}

const backendDir = resolveBackendDir();
const backendManifest = resolve(backendDir, "Cargo.toml");
if (!existsSync(backendManifest)) {
  throw new Error(`Eigen Air Cargo manifest not found: ${backendManifest}`);
}
const quotedBackendManifest = `'${backendManifest.replaceAll("'", `'"'"'`)}'`;
export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "live-daemon-vulkan-scenario.spec.ts",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:25001",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        `cargo build --manifest-path ${quotedBackendManifest} --bins && ` +
        `cargo run --manifest-path ${quotedBackendManifest} --bin eigen-air-test -- --serve-fixture --base-url http://127.0.0.1:18791`,
      url: "http://127.0.0.1:18791/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @eigen-air-ui/web dev --host 127.0.0.1 --port 25001",
      url: "http://127.0.0.1:25001",
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
