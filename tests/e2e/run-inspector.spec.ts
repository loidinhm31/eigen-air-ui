import { expect, test, type Page } from "@playwright/test";

const SESSION_ID = "g2-run-inspector-session";

async function installRunAppFixture(page: Page) {
  await page.addInitScript((sessionId) => {
    localStorage.setItem("nonclaw-daemon-url", "http://127.0.0.1:18791");
    localStorage.setItem("nonclaw-session-id", sessionId);
    localStorage.removeItem("nonclaw-chat-messages");
  }, SESSION_ID);
  await page.route("**/health", (route) =>
    route.fulfill({ json: { status: "ok", version: "0.2.0" } })
  );
  await page.route("**/v1/skills", (route) => route.fulfill({ json: [] }));
  await page.routeWebSocket("ws://127.0.0.1:18791/ws", async (socket) => {
    socket.onMessage((raw) => {
      const request = JSON.parse(String(raw)) as { id: string; method: string };
      const respond = (data: unknown) =>
        socket.send(
          JSON.stringify({
            type: "res",
            id: request.id,
            ok: true,
            data,
          })
        );
      if (request.method === "connect") {
        respond({ session_id: SESSION_ID, agent: "default", version: "0.2.0" });
      } else if (request.method === "sessions.list") {
        respond({
          sessions: [
            {
              id: SESSION_ID,
              channel: "web",
              status: "active",
              started_at: 1,
              updated_at: 1,
            },
          ],
        });
      } else if (request.method === "chat.history") {
        respond({ messages: [] });
      }
    });
  });
}

function runSummary(runId: string, parentRunId: string | null = null) {
  return {
    run_id: runId,
    trace_id: `trace-${runId}`,
    session_id: SESSION_ID,
    root_run_id: parentRunId ?? runId,
    parent_run_id: parentRunId,
    tenant_id: "tenant",
    user_id: "user",
    workspace_id: "workspace",
    agent_id: "agent",
    provider_id: "provider",
    channel: "web",
    lifecycle_status: "completed",
    started_at_ms: 1,
    updated_at_ms: 2,
    completed_at_ms: 2,
    snapshot_seq: 1,
    correlation_state: "correlated",
    redaction: {
      metadata_only: true,
      debug_requested: false,
      debug_available: false,
    },
    usage: { total_tokens: 3, origin: "reported" },
  };
}

test("Runs route uses REST snapshots and keeps ancestry separate", async ({ page }) => {
  await installRunAppFixture(page);
  const runs = [runSummary("run-a"), runSummary("run-b", "run-a")];
  await page.route("**/v1/runs?*", (route) => route.fulfill({ json: { schema_version: 1, runs } }));
  await page.route("**/v1/runs/run-a", (route) =>
    route.fulfill({
      json: {
        schema_version: 1,
        run: runs[0],
        events: [
          {
            event_id: "event-1",
            event_seq: 1,
            event_kind: "run.finished",
            lifecycle_status: "completed",
            occurred_at_ms: 2,
          },
        ],
        tool_calls: [],
        memory_lineage: [],
      },
    })
  );

  await page.goto("/");
  await page.getByRole("link", { name: "Runs" }).click();
  await page.getByRole("button", { name: "run-a" }).click();
  await expect(page.getByLabel("Run run-a")).toBeVisible();
  await expect(page.getByText(/parent Not reported/)).toBeVisible();
  await expect(page.getByText("Status: completed").first()).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("heading", { name: "Run inspector" })).toBeVisible();
});

test("Runs route clears denied detail state without persisting run identity", async ({ page }) => {
  await installRunAppFixture(page);
  const run = runSummary("run-denied");
  await page.route("**/v1/runs?*", (route) =>
    route.fulfill({ json: { schema_version: 1, runs: [run] } })
  );
  await page.route("**/v1/runs/run-denied", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "run_not_found", message: "Run unavailable" }),
    })
  );

  await page.goto("/");
  await page.getByRole("link", { name: "Runs" }).click();
  await page.getByRole("button", { name: "run-denied" }).click();
  await expect(page.getByRole("alert")).toHaveText("Run unavailable.");
  const persisted = await page.evaluate(() => JSON.stringify(localStorage));
  expect(persisted).not.toContain("run-denied");
});
