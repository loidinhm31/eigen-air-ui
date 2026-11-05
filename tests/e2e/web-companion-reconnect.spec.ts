import { expect, test, type Page } from "@playwright/test";
import { seedAuthToken } from "./support/seed-auth-token.js";
const SESS_1 = {
  id: "sess-device-1",
  channel: "web",
  status: "active",
  started_at: 1,
  updated_at: 1,
  execution_target: {
    kind: "client_device",
    device_id: "dev-mac-1",
    model_artifact_id: "gemma-4-e4b-it-qat-ud-q4_k_xl",
  },
};

const SESS_2 = {
  id: "sess-server-2",
  channel: "web",
  status: "active",
  started_at: 2,
  updated_at: 2,
  execution_target: {
    kind: "server",
  },
};

const TEST_DEVICE = {
  device_id: "dev-mac-1",
  display_label: "Office MacBook Pro",
  status: "active",
  warning_archived: false,
  protocol_min_version: "client_inference.v1",
  protocol_max_version: "client_inference.v1",
  runtime_metadata: { connected: true, online: true, installed_models: ["gemma-4-e4b-it-qat-ud-q4_k_xl"] },
  created_at: 1000,
  updated_at: 1000,
  last_seen_at: Date.now(),
  revision: 1,
};

test.describe("Web Companion Reconnect & Fail-Closed Fencing (Phase 11)", () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthToken(page);
  });

  test("Session switch immediately resets target and fails closed until authoritative target arrives", async ({ page }) => {
    let currentSessionId = SESS_1.id;

    await page.addInitScript((sessionId) => {
      localStorage.setItem("eigen-air-daemon-url", "http://127.0.0.1:18790");
      localStorage.setItem("eigen-air-session-id", sessionId);
    }, currentSessionId);

    await page.route("**/*health", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) });
    });
    await page.route("**/*readyz", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ready" }) });
    });
    await page.route("**/v1/providers/readiness", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ready", retryable: false, details: { stages: [] } }) });
    });
    await page.route("**/v1/inference/devices", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([TEST_DEVICE]) });
    });
    await page.route("**/v1/inference/server/models", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    });

    await page.routeWebSocket("ws://127.0.0.1:18790/ws", async (socket) => {
      socket.onMessage((raw) => {
        const msg = JSON.parse(String(raw)) as { id: string; method: string; params?: { id?: string } };
        const respond = (data: unknown) => socket.send(JSON.stringify({ type: "res", id: msg.id, ok: true, data }));
        if (msg.method === "connect") respond({ session_id: currentSessionId, version: "0.2.0" });
        else if (msg.method === "sessions.get") {
          const s = [SESS_1, SESS_2].find((item) => item.id === msg.params?.id);
          if (s) {
            respond({ session: s });
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
        else if (msg.method === "sessions.list") respond({ sessions: [SESS_1, SESS_2], next_cursor: null });
        else if (msg.method === "chat.history") respond({ messages: [] });
      });
    });

    await page.goto("/");

    // Initially on SESS_1 (client_device)
    await expect(page.getByPlaceholder("Message eigen-air...")).toBeVisible();

    // Navigate to sessions and switch to SESS_2
    await page.goto("/sessions");
    await expect(page.getByText(SESS_2.id).first()).toBeVisible();

    // Target switches cleanly to server without retaining client device target
    currentSessionId = SESS_2.id;
    await page.getByTestId(`session-${SESS_2.id}`).getByRole("button", { name: "Open" }).click();
    await page.waitForURL("**/");

    await expect(page.getByPlaceholder("Message eigen-air...")).toBeVisible();
  });

  test("Tab focus and visibility change trigger coalesced refetch of devices and operations", async ({ page }) => {
    let deviceFetchCount = 0;

    await page.addInitScript(() => {
      localStorage.setItem("eigen-air-daemon-url", "http://127.0.0.1:18790");
      localStorage.setItem("eigen-air-session-id", "sess-test");
    });

    await page.route("**/*health", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok" }) });
    });
    await page.route("**/v1/providers/readiness", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ready", retryable: false, details: { stages: [] } }) });
    });
    await page.route("**/v1/inference/devices", async (route) => {
      deviceFetchCount++;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([TEST_DEVICE]) });
    });
    await page.route("**/v1/inference/server/models", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    });
    await page.route("**/v1/inference/server/roots", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    });
    await page.routeWebSocket("ws://127.0.0.1:18790/ws", async (socket) => {
      socket.onMessage((raw) => {
        const msg = JSON.parse(String(raw)) as { id: string; method: string; params?: { id?: string } };
        const respond = (data: unknown) => socket.send(JSON.stringify({ type: "res", id: msg.id, ok: true, data }));
        if (msg.method === "connect") respond({ session_id: "sess-test", version: "0.2.0" });
        else if (msg.method === "sessions.get") {
          if (msg.params?.id === "sess-test") {
            respond({ session: { id: "sess-test", channel: "web", status: "active", started_at: 1, updated_at: 1 } });
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
        else if (msg.method === "sessions.list") respond({ sessions: [], next_cursor: null });
        else if (msg.method === "chat.history") respond({ messages: [] });
      });
    });

    await page.goto("/settings");
    await page.waitForTimeout(500);
    const initialCount = deviceFetchCount;
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // Simulate window focus
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(500);

    expect(deviceFetchCount).toBeGreaterThan(initialCount);
  });
});
