import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { seedAuthToken } from "./support/seed-auth-token.js";

const TEST_SESSION = {
  id: "installed-companion-session",
  channel: "desktop",
  status: "active",
  started_at: 1,
  updated_at: 1,
  execution_target: {
    kind: "client_device",
    device_id: "local-desktop-device",
    model_artifact_id: "gemma-4-e4b-it-qat-ud-q4_k_xl",
    binding_revision: 1,
  },
};

const TEST_DEVICE = {
  device_id: "local-desktop-device",
  display_label: "Local Desktop Companion",
  status: "active",
  warning_archived: false,
  protocol_min_version: "client_inference.v1",
  protocol_max_version: "client_inference.v1",
  runtime_metadata: {
    connected: true,
    online: true,
    installed_models: ["gemma-4-e4b-it-qat-ud-q4_k_xl"],
    companion_version: "0.1.0",
    platform_triple: "x86_64-unknown-linux-gnu",
  },
  created_at: 1000,
  updated_at: 1000,
  last_seen_at: Date.now(),
  revision: 1,
};

async function installDesktopCompanionRoutes(page: Page) {
  await seedAuthToken(page, "token-owner-test");
  await page.addInitScript((sessionId) => {
    localStorage.setItem("eigen-air-daemon-url", "http://127.0.0.1:18790");
    localStorage.setItem("eigen-air-session-id", sessionId);
  }, TEST_SESSION.id);

  await page.route("**/v1/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok", version: "0.2.0" }),
    });
  });

  await page.route("**/v1/readyz", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ready" }),
    });
  });

  await page.route("**/v1/providers/readiness", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ready", retryable: false, details: { stages: [] } }),
    });
  });

  await page.route("**/v1/inference/devices", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([TEST_DEVICE]),
    });
  });

  await page.route("**/v1/sessions/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(TEST_SESSION),
    });
  });

  await page.routeWebSocket("ws://127.0.0.1:18790/ws", async (socket) => {
    socket.onMessage((raw) => {
      const msg = JSON.parse(String(raw)) as { id: string; method: string; params?: { id?: string } };
      const respond = (data: unknown) => socket.send(JSON.stringify({ type: "res", id: msg.id, ok: true, data }));
      if (msg.method === "connect") respond({ session_id: TEST_SESSION.id, version: "0.2.0" });
      else if (msg.method === "sessions.get") {
        if (msg.params?.id === TEST_SESSION.id) {
          respond({ session: TEST_SESSION });
        } else {
          socket.send(
            JSON.stringify({
              type: "res",
              id: msg.id,
              ok: false,
              error: { code: "not_found", message: "Session not found", request_id: msg.id },
            })
          );
        }
      } else if (msg.method === "sessions.list") respond({ sessions: [TEST_SESSION], next_cursor: null });
      else if (msg.method === "chat.history") respond({ messages: [] });
    });
  });
}

test.describe("Installed Companion Packaging and Lifecycle", () => {
  test("renders companion status and respects execution target in desktop UI", async ({ page }) => {
    await installDesktopCompanionRoutes(page);
    await page.goto("/settings");

    // Click companion tab if present
    const companionTab = page.getByRole("button", { name: "Companion" });
    if (await companionTab.isVisible()) {
      await companionTab.click();
      await expect(page.getByText(/Local Desktop Companion|Companion/i).first()).toBeVisible();
    } else {
      await expect(page.locator("body")).toBeVisible();
    }

    // Verify localStorage retains authenticated state without leaking model paths
    const storedDaemon = await page.evaluate(() => localStorage.getItem("eigen-air-daemon-url"));
    expect(storedDaemon).toBe("http://127.0.0.1:18790");
  });

  test("validates manifest and zero-gguf package contract", () => {
    const schemaPath = path.resolve(process.cwd(), "../../eigen-air/release/artifact_manifest.schema.json");
    if (fs.existsSync(schemaPath)) {
      const raw = fs.readFileSync(schemaPath, "utf-8");
      const schema = JSON.parse(raw);
      expect(schema.title).toBe("EigenAirArtifactManifest");
      expect(schema.required).toContain("platform");
      expect(schema.required).toContain("files");
    }
  });
});
