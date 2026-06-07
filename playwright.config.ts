import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const nonclawDir = existsSync("../../../nonclaw/Cargo.toml") ? "../../../nonclaw" : "nonclaw";

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
        `cargo run --manifest-path ${nonclawDir}/Cargo.toml --bin nonclaw-test -- --serve-fixture --base-url http://127.0.0.1:18791`,
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
