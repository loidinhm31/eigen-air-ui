import { expect, test, type Page } from "@playwright/test";

const SESSION_ID = "session-release-a-test";

async function installReleaseAFixture(page: Page) {
  await page.addInitScript((sessionId) => {
    localStorage.setItem("eigen-air-daemon-url", "http://127.0.0.1:18791");
    localStorage.setItem("eigen-air-session-id", sessionId);
    localStorage.removeItem("eigen-air-chat-messages");
  }, SESSION_ID);

  await page.route("**/health", (route) =>
    route.fulfill({ json: { status: "ok", version: "0.2.0" } })
  );
  await page.route("**/v1/skills", (route) => route.fulfill({ json: [] }));

  await page.routeWebSocket("ws://127.0.0.1:18791/ws", async (socket) => {
    socket.onMessage((raw) => {
      const request = JSON.parse(String(raw)) as { id: string; method: string; params?: { id?: string } };
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
      } else if (request.method === "sessions.get") {
        if (request.params?.id === SESSION_ID) {
          respond({
            session: {
              id: SESSION_ID,
              channel: "web",
              status: "active",
              started_at: 1_700_000_000_000,
              updated_at: 1_700_000_000_000,
            },
          });
        } else {
          socket.send(
            JSON.stringify({
              type: "res",
              id: request.id,
              ok: false,
              error: { code: "not_found", message: "Session not found", request_id: request.id },
            })
          );
        }
      } else if (request.method === "sessions.list") {
        respond({
          sessions: [
            {
              id: SESSION_ID,
              channel: "web",
              status: "active",
              started_at: 1_700_000_000_000,
              updated_at: 1_700_000_000_000,
            },
          ],
          next_cursor: null,
        });
      } else if (request.method === "chat.history") {
        respond({ messages: [] });
      }
    });
  });
}

function makeRunSummary(id: string, overrides: Record<string, unknown> = {}) {
  return {
    run_id: id,
    trace_id: `trace-${id}`,
    session_id: SESSION_ID,
    root_run_id: id,
    parent_run_id: null,
    tenant_id: "tenant-1",
    user_id: "user-1",
    workspace_id: "ws-1",
    agent_id: "agent-1",
    provider_id: "provider-1",
    channel: "web",
    lifecycle_status: "completed",
    started_at_ms: 1_700_000_000_000,
    updated_at_ms: 1_700_000_002_000,
    completed_at_ms: 1_700_000_002_000,
    snapshot_seq: 1,
    correlation_state: "correlated",
    redaction: {
      metadata_only: true,
      debug_requested: false,
      debug_available: false,
    },
    usage: { total_tokens: 42, origin: "reported" },
    ...overrides,
  };
}

test("Release A connected owner journey: chat -> runs -> paging -> diagnostics -> child run -> memory -> return", async ({
  page,
}) => {
  await installReleaseAFixture(page);

  const rootRun = makeRunSummary("run-root-fail", {
    lifecycle_status: "failed",
    completed_at_ms: 1_700_000_003_500,
  });
  const childRun = makeRunSummary("run-child-delegated", {
    parent_run_id: "run-root-fail",
    root_run_id: "run-root-fail",
    lifecycle_status: "succeeded",
  });
  const runPage2 = makeRunSummary("run-older-session-item");

  const runTreeNodes = [
    {
      id: "tree-node-1",
      root_session_id: SESSION_ID,
      parent_session_id: SESSION_ID,
      child_session_id: "session-child-1",
      parent_run_id: "run-root-fail",
      child_run_id: "run-child-delegated",
      root_run_id: "run-root-fail",
      delegated_task_id: "task-child-1",
      source_agent_id: "lead-agent",
      target_agent_id: "worker-agent",
      depth: 1,
      created_at: 1_700_000_001_000,
    },
  ];

  await page.route("**/v1/runs?*", (route) => {
    const url = route.request().url();
    if (url.includes("cursor=cursor-page-2")) {
      return route.fulfill({
        json: {
          schema_version: 1,
          runs: [runPage2],
          next_cursor: null,
        },
      });
    }
    return route.fulfill({
      json: {
        schema_version: 1,
        runs: [rootRun],
        next_cursor: "cursor-page-2",
      },
    });
  });

  await page.route("**/v1/runs/run-root-fail", (route) =>
    route.fulfill({
      json: {
        schema_version: 1,
        run: rootRun,
        events: [
          {
            event_id: "ev-1",
            event_seq: 1,
            event_kind: "run.started",
            lifecycle_status: "running",
            occurred_at_ms: 1_700_000_000_000,
          },
          {
            event_id: "ev-tool",
            event_seq: 2,
            event_kind: "tool_selection",
            occurred_at_ms: 1_700_000_001_000,
            tool_selection: {
              schema_version: "tool_selection.v1",
              effective_cap: 1,
              checked_count: 3,
              eligible_count: 3,
              selected_count: 1,
              rejected_count: 2,
              reason_counts: {
                security_denied: 1,
                budget_dropped: 1,
              },
              selected_tools: [
                {
                  canonical_name: "web_search",
                  reason_code: "required_selected",
                },
              ],
              rejected_tools: [
                {
                  canonical_name: "shell_exec",
                  reason_code: "security_denied",
                },
                {
                  canonical_name: "fetch_web",
                  reason_code: "budget_dropped",
                },
              ],
              name_details_redacted: false,
            },
          },
          {
            event_id: "ev-2",
            event_seq: 3,
            event_kind: "run.failed",
            lifecycle_status: "failed",
            occurred_at_ms: 1_700_000_003_500,
          },
        ],
        tool_calls: [
          {
            tool_call_id: "call-1",
            ordinal: 1,
            tool_name: "web_search",
            status: "failed",
            safe_error_code: "NETWORK_UNREACHABLE",
            started_at_ms: 1_700_000_001_000,
            completed_at_ms: 1_700_000_001_350,
          },
        ],
        memory_lineage: [
          {
            lineage_seq: 1,
            memory_kind: "episode",
            relation: "used",
            memory_reference: "ep-101",
            tenant_id: "tenant-1",
            user_id: "user-1",
            workspace_id: "ws-1",
            agent_id: "agent-1",
            confidence: 0.95,
          },
        ],
        task_progress: {
          artifact_type: "task_progress",
          schema_version: 1,
          artifact_id: "art-1",
          root_session_id: SESSION_ID,
          task_id: "task-root-1",
          subagent_run_id: "run-root-fail",
          run_id: "run-root-fail",
          trace_id: "trace-run-root-fail",
          parent_run_id: null,
          root_run_id: "run-root-fail",
          projection_status: "failed",
          verification_status: "unverified",
          artifact_revision: 3,
          artifact_event_seq: 5,
          g2_snapshot_seq: 2,
          claimed_active_count: 0,
          claimed_item_count: 2,
          updated_at_ms: 1_700_000_003_500,
          terminal_at_ms: 1_700_000_003_500,
          redaction: { metadata_only: true, hidden_fields: [] },
        },
      },
    })
  );

  await page.route("**/v1/runs/run-child-delegated", (route) =>
    route.fulfill({
      json: {
        schema_version: 1,
        run: childRun,
        events: [],
        tool_calls: [],
        memory_lineage: [],
        task_progress: {
          artifact_type: "task_progress",
          schema_version: 1,
          artifact_id: "art-child-1",
          root_session_id: SESSION_ID,
          task_id: "task-child-1",
          subagent_run_id: "run-child-delegated",
          run_id: "run-child-delegated",
          trace_id: "trace-run-child-delegated",
          parent_run_id: "run-root-fail",
          root_run_id: "run-root-fail",
          projection_status: "succeeded",
          verification_status: "verified_success",
          artifact_revision: 2,
          artifact_event_seq: 4,
          g2_snapshot_seq: 1,
          claimed_active_count: 0,
          claimed_item_count: 1,
          updated_at_ms: 1_700_000_002_000,
          terminal_at_ms: 1_700_000_002_000,
          redaction: { metadata_only: true, hidden_fields: [] },
        },
      },
    })
  );

  await page.route(`**/v1/run-trees/${SESSION_ID}`, (route) =>
    route.fulfill({ json: runTreeNodes })
  );

  await page.route("**/v1/memory/episodes**", (route) => {
    const url = route.request().url();
    if (url.includes("/episodes/ep-101")) {
      return route.fulfill({
        json: {
          id: "ep-101",
          scope: { session_id: SESSION_ID },
          input: "User requested system diagnostics",
          output: "Diagnostics finished with error",
          summary: "System diagnostics turn",
          created_at: 1_700_000_000_000,
        },
      });
    }
    return route.fulfill({
      json: [
        {
          id: "ep-101",
          scope: { session_id: SESSION_ID },
          input: "User requested system diagnostics",
          output: "Diagnostics finished with error",
          summary: "System diagnostics turn",
          created_at: 1_700_000_000_000,
        },
      ],
    });
  });

  await page.route("**/v1/vault/knowledge/facts**", (route) =>
    route.fulfill({ json: [] })
  );

  await page.route("**/v1/memory/working**", (route) =>
    route.fulfill({ json: [] })
  );

  // 1. Start on Chat, verify connected
  await page.goto("/");
  await expect(page.getByText("connected")).toBeVisible({ timeout: 15_000 });

  // 2. Navigate to Runs via top navigation
  await page.getByRole("link", { name: "Runs" }).click();
  await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();

  // 3. Paging check: Load more runs button is present
  const loadMoreBtn = page.getByRole("button", { name: "Load more runs" });
  await expect(loadMoreBtn).toBeVisible();
  await loadMoreBtn.click();
  await expect(page.getByRole("button", { name: "run-older-session-item" })).toBeVisible();

  // 4. Select the failed run
  await page.getByRole("button", { name: "run-root-fail" }).click();
  await expect(page.getByLabel("Run run-root-fail")).toBeVisible();
  await expect(page.getByText("Status: failed").first()).toBeVisible();
  await expect(page.getByText("3500 ms")).toBeVisible();

  // 5. Tool decisions & tool calls diagnostics
  const decisionsSection = page.getByRole("region", { name: "Tool selection decisions" });
  await expect(decisionsSection).toBeVisible();
  await expect(decisionsSection.getByText("shell_exec")).toBeVisible();
  await expect(decisionsSection.getByText("Security denied").first()).toBeVisible();
  await expect(decisionsSection.getByText("fetch_web")).toBeVisible();
  await expect(decisionsSection.getByText("Budget dropped").first()).toBeVisible();
  await expect(page.getByText("Safe error: NETWORK_UNREACHABLE")).toBeVisible();
  // 6. Delegation lifecycle & run tree navigation
  await expect(page.getByText("Delegation progress & lifecycle")).toBeVisible();
  await expect(page.getByTestId("projection-status")).toHaveText("Failed (terminal)");
  const childLink = page.getByRole("button", { name: "Navigate to child run run-child-delegated" });
  await expect(childLink).toBeVisible();

  // Click child run
  await childLink.click();
  await expect(page.getByLabel("Run run-child-delegated")).toBeVisible();
  await expect(page.getByTestId("projection-status")).toHaveText("Succeeded (terminal)");

  // Navigate back to parent run via parent run link
  const parentLink = page.getByRole("button", { name: "Navigate to parent run run-root-fail" });
  await expect(parentLink).toBeVisible();
  await parentLink.click();
  await expect(page.getByLabel("Run run-root-fail")).toBeVisible();

  // 7. Memory lineage inspection & source navigation
  await expect(page.getByText("Server-proven memory lineage")).toBeVisible();
  await expect(page.getByText("used (included in request)")).toBeVisible();
  const memorySourceBtn = page.getByRole("button", { name: "View episode source for ep-101" });
  await expect(memorySourceBtn).toBeVisible();

  // Click memory source to drill down to Memory page
  await memorySourceBtn.click();
  await expect(page).toHaveURL(/.*\/memory\?episode_id=ep-101/);
  const container = page.getByTestId("focused-episode-container");
  await expect(container).toBeVisible();
  await expect(container.getByText("Lineage focus")).toBeVisible();
  await expect(container.getByText("Focused source")).toBeVisible();
  await expect(container.getByText("ep-101").first()).toBeVisible();

  // 8. Return to Runs page: state is clean, no memory leaks or stale errors
  await page.getByRole("link", { name: "Runs" }).click();
  await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();
  await expect(page.getByRole("button", { name: "run-root-fail" })).toBeVisible();
});

test("Runs route handles rapid navigation and error isolation without state corruption", async ({
  page,
}) => {
  await installReleaseAFixture(page);

  const runA = makeRunSummary("run-quick-a");
  const runB = makeRunSummary("run-quick-b");

  await page.route("**/v1/runs?*", (route) =>
    route.fulfill({
      json: { schema_version: 1, runs: [runA, runB], next_cursor: null },
    })
  );

  // run-quick-a has delayed response
  await page.route("**/v1/runs/run-quick-a", async (route) => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 250);
    await promise;
    return route.fulfill({
      json: {
        schema_version: 1,
        run: runA,
        events: [],
        tool_calls: [],
        memory_lineage: [],
      },
    });
  });

  // run-quick-b returns 404
  await page.route("**/v1/runs/run-quick-b", (route) =>
    route.fulfill({
      status: 404,
      json: { error: "not_found", message: "Run not found" },
    })
  );

  await page.goto("/");
  await page.getByRole("link", { name: "Runs" }).click();

  // Click A, then immediately click B before A resolves
  await page.getByRole("button", { name: "run-quick-a" }).click();
  await page.getByRole("button", { name: "run-quick-b" }).click();

  // Error alert for B should display, and delayed A response should NOT overwrite B
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("Run unavailable.");
});
