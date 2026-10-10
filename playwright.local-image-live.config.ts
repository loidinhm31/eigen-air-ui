import { defineConfig } from "@playwright/test";

/**
 * Phase 09 live local-image Playwright configuration.
 *
 * Runs browser qualification against a real running eigen-air daemon and web UI
 * (no synthetic fixture server or route interception substitute).
 *
 * Environment variables:
 *   EIGEN_AIR_UI_URL      - Web UI base URL (default: http://127.0.0.1:25001)
 *   EIGEN_AIR_DAEMON_URL  - Daemon base URL (default: http://127.0.0.1:18790)
 *   EIGEN_AIR_AUTH_TOKEN  - Bearer token for authenticated qualification session
 */
const uiBaseUrl = process.env.EIGEN_AIR_UI_URL || "http://127.0.0.1:25001";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "local-image-live.spec.ts",
  timeout: 180_000,
  use: {
    baseURL: uiBaseUrl,
    trace: "retain-on-failure",
  },
});
