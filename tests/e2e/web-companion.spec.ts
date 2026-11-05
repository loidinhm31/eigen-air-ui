import { expect, test, type Page } from "@playwright/test";
import { seedAuthToken } from "./support/seed-auth-token.js";
const TEST_SESSION = {
  id: "web-comp-session",
  channel: "web",
  status: "active",
  started_at: 1,
  updated_at: 1,
  execution_target: {
    kind: "client_device",
    device_id: "dev-mac-1",
    model_artifact_id: "gemma-4-e4b-it-qat-ud-q4_k_xl",
    binding_revision: 1,
  },
};

const TEST_DEVICE = {
  device_id: "dev-mac-1",
  display_label: "Office MacBook Pro",
  status: "active",
  warning_archived: false,
  protocol_min_version: "client_inference.v1",
  protocol_max_version: "client_inference.v1",
  runtime_metadata: {
    connected: true,
    online: true,
    installed_models: ["gemma-4-e4b-it-qat-ud-q4_k_xl"],
  },
  created_at: 1000,
  updated_at: 1000,
  last_seen_at: Date.now(),
  revision: 1,
};

async function installWebCompanionRoutes(page: Page) {
  await page.addInitScript((sessionId) => {
    localStorage.setItem("eigen-air-daemon-url", "http://127.0.0.1:18790");
    localStorage.setItem("eigen-air-session-id", sessionId);
  }, TEST_SESSION.id);

  await page.route("**/*health", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", version: "0.2.0" }) });
  });

  await page.route("**/v1/providers/readiness", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ready", retryable: false, details: { stages: [] } }),
    });
  });

  await page.route("**/v1/inference/devices", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([TEST_DEVICE]) });
  });

  await page.route("**/v1/inference/server/models", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });

  await page.route("**/v1/inference/server/roots", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });

  await page.route("**/v1/inference/pairings/*/approve", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "approved", pairing_id: "pair-123", expires_at_ms: Date.now() + 600000 }),
    });
  });

  await page.route("**/v1/inference/devices/*/storage-selection", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          request_id: "req-sel-1",
          device_id: "dev-mac-1",
          kind: "model_root",
          status: "awaiting_local_approval",
          expires_at_ms: Date.now() + 600000,
        }),
      });
    }
  });

  await page.route("**/v1/inference/devices/*/storage-selection/*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        request_id: "req-sel-1",
        device_id: "dev-mac-1",
        kind: "model_root",
        status: "approved",
        approved_root_id: "root-nvme-42",
        approved_label: "Fast SSD",
        expires_at_ms: Date.now() + 600000,
      }),
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
      }
      else if (msg.method === "sessions.list") respond({ sessions: [TEST_SESSION], next_cursor: null });
      else if (msg.method === "chat.history") respond({ messages: [] });
    });
  });
}

test.describe("Web Companion Experience (Phase 11)", () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthToken(page, "token-owner-test");
  });
  test("Settings companion view renders install guide, code approval and remote storage flow", async ({ page }) => {
    await installWebCompanionRoutes(page);
    await page.goto("/settings");

    // Click companion tab
    const companionTab = page.getByRole("button", { name: "Companion" });
    await expect(companionTab).toBeVisible();
    await companionTab.click();
    const pairBtn = page.getByRole("button", { name: "+ Pair Another Companion" });
    if (await pairBtn.isVisible()) {
      await pairBtn.click();
    }

    // Verify install card notes
    await expect(page.getByText(/Install Companion Daemon|Companion Required/i)).toBeVisible();
    await expect(page.getByText(/Browser does not execute native weights|does not execute native model weights/i)).toBeVisible();
    // Verify pairing approval card
    await expect(page.getByText(/Companion Pairing Approval|Pair Companion Device/i)).toBeVisible();
    const pairingInput = page.getByLabel("Pairing ID");
    await pairingInput.fill("pair-123");
    const codeInput = page.getByLabel("6-Digit Verification Code");
    await codeInput.fill("123-456");

    await page.getByRole("button", { name: /Approve (Companion )?Pairing/i }).click();
    await expect(page.getByText(/Pairing approved on server/i)).toBeVisible();

    // Verify paired device and remote storage flow
    await expect(page.getByText("Office MacBook Pro")).toBeVisible();
    const storageBtn = page.getByRole("button", { name: "Remote Storage" });
    await expect(storageBtn).toBeVisible();
    await storageBtn.click();

    // Remote folder request view renders
    await expect(page.getByText("Remote Storage Selection")).toBeVisible();
  });

  test("Chat composer shows explicit New Server Session action when device target is offline", async ({ page }) => {
    // Set device to offline in metadata
    const offlineDevice = { ...TEST_DEVICE, runtime_metadata: { connected: false, online: false } };

    await page.addInitScript((sessionId) => {
      localStorage.setItem("eigen-air-daemon-url", "http://127.0.0.1:18790");
      localStorage.setItem("eigen-air-session-id", sessionId);
    }, TEST_SESSION.id);

    await page.route("**/*health", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) });
    });
    await page.route("**/v1/providers/readiness", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ready", retryable: false, details: { stages: [] } }) });
    });
    await page.route("**/v1/inference/devices", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([offlineDevice]) });
    });
    await page.route("**/v1/sessions", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "new-server-sess", execution_target: { kind: "server" } }) });
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
        }
        else if (msg.method === "sessions.list") respond({ sessions: [TEST_SESSION], next_cursor: null });
        else if (msg.method === "chat.history") respond({ messages: [] });
      });
    });

    await page.goto("/");

    // Expect alert banner and New Server Session button
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "New Server Session" })).toBeVisible();
  });
});
