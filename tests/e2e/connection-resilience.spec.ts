import { expect, test, type Page } from "@playwright/test";
import { seedAuthToken } from "./support/seed-auth-token.js";

async function installCommonRoutes(page: Page) {
  await page.route("**/*health", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", version: "0.2.0" }) })
  );
  await page.route("**/v1/providers/readiness", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ready", retryable: false, details: { stages: [] } }) })
  );
  await page.route("**/v1/config", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "0.2.0" }) })
  );
  await page.route("**/v1/status", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ agents: [] }) })
  );
  await page.route("**/v1/skills", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
  );
}

function makeSession(id: string, title: string, index: number) {
  return {
    id,
    agent_id: "agent-default",
    provider_id: "default",
    workspace_id: "default",
    status: "active",
    channel: "web",
    title,
    started_at: 1700000000 + index,
    updated_at: 1700000000 + index,
    completed_at: null,
    inference_target: { kind: "server", provider_id: "default" },
    execution_target: { kind: "server", provider_id: "default" },
  };
}

test.describe("Connection Resilience and Pagination Regression", () => {
  test("Sessions page renders >64 KiB first page and paginates to 120 rows", async ({ page }) => {
    await seedAuthToken(page);
    await installCommonRoutes(page);
    // Note: The UI requests limit: 50, but per Phase 07 specification this fixture intentionally returns
    // a 100-row page to stress test >64 KiB frame decoding and row append handling.
    const title504 = "日本語タイトルテスト境界検証".repeat(12);
    expect(Buffer.byteLength(title504, "utf8")).toBeLessThanOrEqual(512);
    const page1Sessions = Array.from({ length: 100 }, (_, i) =>
      makeSession(`sess-page1-${String(i).padStart(3, "0")}`, `${title504} [${i}]`, i)
    );
    const page2Sessions = Array.from({ length: 20 }, (_, i) =>
      makeSession(`sess-page2-${String(i).padStart(3, "0")}`, `Second page item ${i}`, 100 + i)
    );
    await page.addInitScript((sessionId) => {
      localStorage.setItem("eigen-air-session-id", sessionId);
    }, page1Sessions[0].id);

    const firstPageFrame = JSON.stringify({
      type: "res",
      id: "probe",
      ok: true,
      data: { sessions: page1Sessions, next_cursor: "cur-p2" },
    });
    expect(Buffer.byteLength(firstPageFrame, "utf8")).toBeGreaterThan(65536);

    await page.routeWebSocket(/\/ws$/, async (socket) => {
      socket.onMessage((raw) => {
        const msg = JSON.parse(String(raw)) as {
          id: string;
          method: string;
          params?: { cursor?: string; id?: string };
        };
        const respond = (data: unknown) =>
          socket.send(JSON.stringify({ type: "res", id: msg.id, ok: true, data }));

        if (msg.method === "connect") {
          respond({ session_id: page1Sessions[0].id, version: "0.2.0" });
        } else if (msg.method === "sessions.create") {
          respond(page1Sessions[0]);
        } else if (msg.method === "sessions.get") {
          respond({ session: page1Sessions[0] });
        } else if (msg.method === "sessions.list") {
          if (!msg.params?.cursor) {
            respond({ sessions: page1Sessions, next_cursor: "cur-p2" });
          } else if (msg.params.cursor === "cur-p2") {
            respond({ sessions: page2Sessions, next_cursor: null });
          }
        } else if (msg.method === "chat.history") {
          respond({ messages: [] });
        }
      });
    });
    await page.goto("/");
    await expect(page.getByText("connected", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Sessions" }).click();
    // First page exceeds former 64 KiB frame ceiling and renders all 100 items
    await expect(page.locator('[data-testid^="session-"]')).toHaveCount(100);

    // "Load more sessions" button is displayed because next_cursor is present
    const loadMoreBtn = page.getByRole("button", { name: "Load more sessions" });
    await expect(loadMoreBtn).toBeVisible();

    // Click to fetch the second page (20 additional items)
    await loadMoreBtn.click();

    // All 120 items are rendered and next_cursor null removes the load more button
    await expect(page.locator('[data-testid^="session-"]')).toHaveCount(120);
    await expect(loadMoreBtn).toHaveCount(0);
  });

  test("Settings Connect where mock never answers sessions.get settles on deadline and keeps Connect/Clear enabled", async ({ page }) => {
    await seedAuthToken(page);
    await installCommonRoutes(page);
    await page.addInitScript(() => {
      localStorage.setItem("eigen-air-session-id", "test-sess-1");
    });
    await page.clock.install();

    let manualAttemptSessionsGet = false;
    let targetSessionId = "";
    let connectClicked = false;

    await page.routeWebSocket(/\/ws$/, async (socket) => {
      socket.onMessage((raw) => {
        const msg = JSON.parse(String(raw)) as {
          id: string;
          method: string;
          params?: { id?: string };
        };
        const respond = (data: unknown) =>
          socket.send(JSON.stringify({ type: "res", id: msg.id, ok: true, data }));

        if (msg.method === "connect") {
          respond({ session_id: "test-sess-1", version: "0.2.0" });
        } else if (msg.method === "sessions.get") {
          if (connectClicked) {
            manualAttemptSessionsGet = true;
            targetSessionId = msg.params?.id ?? "";
          }
          // Intentionally do not answer sessions.get to test settlement deadline
        } else if (msg.method === "sessions.list") {
          respond({ sessions: [], next_cursor: null });
        } else if (msg.method === "chat.history") {
          respond({ messages: [] });
        }
      });
    });

    await page.goto("/settings");

    const connectBtn = page.getByRole("button", { name: "Connect" });
    const clearBtn = page.getByRole("button", { name: "Clear" });

    await expect(connectBtn).toBeVisible();
    await expect(connectBtn).toBeEnabled();

    connectClicked = true;
    await connectBtn.click();

    // While connecting, Connect button enters loading state and is disabled
    await expect(page.getByRole("button", { name: "Loading..." })).toBeDisabled();
    await expect(clearBtn).toBeDisabled();

    // Verify sessions.get RPC was actually dispatched for the manual attempt
    await expect.poll(() => manualAttemptSessionsGet).toBe(true);
    expect(targetSessionId).toBe("test-sess-1");

    // Advance page clock past 30-second default request timeout
    await page.clock.runFor(31_000);

    // Assert Connect and Clear are re-enabled and error alert explicitly names sessions.get timeout
    await expect(connectBtn).toBeEnabled();
    await expect(clearBtn).toBeEnabled();

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("sessions.get timed out after 30000ms; outcome unknown");
  });

  test("Fresh storage with unauthorized connect response displays notice, stores no token, and links to Settings", async ({ page }) => {
    await installCommonRoutes(page);

    await page.routeWebSocket(/\/ws$/, async (socket) => {
      socket.onMessage((raw) => {
        const msg = JSON.parse(String(raw)) as { id: string; method: string };
        if (msg.method === "connect") {
          socket.send(
            JSON.stringify({
              type: "res",
              id: msg.id,
              ok: false,
              error: {
                code: "unauthorized",
                message: "Invalid token",
                request_id: msg.id,
              },
            })
          );
          socket.close();
        }
      });
    });

    // Launch without seeding an auth token
    await page.goto("/");

    // ConnectionErrorNotice alert is visible
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("Authentication required");

    // Clicking Settings link in the notice navigates to Settings
    const settingsLink = alert.getByRole("link", { name: "Settings" });
    await expect(settingsLink).toBeVisible();
    await settingsLink.click();
    await expect(page).toHaveURL(/.*settings/);

    // Verify localStorage has no stored token
    const storedToken = await page.evaluate(() => localStorage.getItem("eigen-air-auth-token"));
    expect(storedToken).toBeNull();
  });
});
