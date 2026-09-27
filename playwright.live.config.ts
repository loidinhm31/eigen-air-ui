import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "live-daemon-vulkan-scenario.spec.ts",
  timeout: 120_000,
  use: {
    baseURL: "http://127.0.0.1:25001",
    trace: "retain-on-failure",
  },
});
