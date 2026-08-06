import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const { NONCLAW_DIR: configuredNonclawDir } = process.env;
const nonclawDir = resolve(
  configuredNonclawDir
    ? configuredNonclawDir
    : existsSync("../../../nonclaw/Cargo.toml")
      ? "../../../nonclaw"
      : "nonclaw"
);
const nonclawManifest = resolve(nonclawDir, "Cargo.toml");
if (!existsSync(nonclawManifest)) {
  throw new Error(`Nonclaw Cargo manifest not found: ${nonclawManifest}`);
}
const quotedNonclawManifest = `'${nonclawManifest.replaceAll("'", `'"'"'`)}'`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:25001",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        `cargo build --manifest-path ${quotedNonclawManifest} --bins && ` +
        `cargo run --manifest-path ${quotedNonclawManifest} --bin nonclaw-test -- --serve-fixture --base-url http://127.0.0.1:18791`,
      url: "http://127.0.0.1:18791/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @nonclaw-ui/web dev --host 127.0.0.1 --port 25001",
      url: "http://127.0.0.1:25001",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
