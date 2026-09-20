import { expect, test, type Page } from "@playwright/test";

const SESSION_ID = "g4-approval-session";
const APPROVAL_ID = "44444444-4444-4444-8444-444444444444";
const RUN_ID = "g4-run-1";
const TOOL_CALL_ID = "call-1";

type Phase = "empty" | "pending" | "approved_once" | "denied";

interface G4FixtureOptions {
  delayResolveMs?: number;
}

interface G4FixtureState {
  phase: Phase;
  listCalls: number;
  detailCalls: number;
  resolveCalls: number;
  lastResolveBody?: Record<string, unknown>;
  toolCallsEmitted: string[];
  activeSocket?: { close: () => void; send: (message: string) => void };
  pendingChatSendResolve?: (data: unknown) => void;
}

function pendingSnapshot() {
  const now = Date.now();
  return {
    approval_id: APPROVAL_ID,
    schema_version: "tool_approval.v1",
    tenant_id: "tenant-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    session_id: SESSION_ID,
    run_id: RUN_ID,
    tool_call_id: TOOL_CALL_ID,
    ordinal: 1,
    tool_name: "shell",
    operation: "execute",
    risk: "high",
    state: "pending",
    safe_summary: {
      program: "ls",
      args_count: 1,
      working_dir: "workspace_root",
    },
    binding_digest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    revision: 1,
    created_at_ms: now,
    expires_at_ms: now + 900_000,
    terminal_at_ms: null,
    terminal_code: null,
    decision_by_credential_id: null,
    redaction: "metadata_only",
  };
}

async function installG4Fixture(page: Page, options: G4FixtureOptions = {}) {
  const state: G4FixtureState = {
    phase: "empty",
    listCalls: 0,
    detailCalls: 0,
    resolveCalls: 0,
    toolCallsEmitted: [],
  };

  await page.addInitScript((sessionId) => {
    localStorage.setItem("nonclaw-daemon-url", "http://127.0.0.1:18791");
    localStorage.setItem("nonclaw-session-id", sessionId);
    localStorage.removeItem("nonclaw-chat-messages");
  }, SESSION_ID);

  await page.route("**/v1/skills", (route) => route.fulfill({ json: [] }));

  await page.route("**/v1/tool-approvals**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const segments = url.pathname.split("/").filter(Boolean);
    const approvalsIndex = segments.indexOf("tool-approvals");
    const suffix = segments.slice(approvalsIndex + 1);
    const approvalId = suffix[0];

    if (!approvalId) {
      state.listCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schema_version: "tool_approval.v1",
          approvals: state.phase === "pending" ? [pendingSnapshot()] : [],
          redaction: "metadata_only",
        }),
      });
      return;
    }

    if (suffix[1] === "resolve") {
      state.resolveCalls += 1;
      state.lastResolveBody = JSON.parse(request.postData() ?? "{}");
      const decision = state.lastResolveBody?.decision;

      if (options.delayResolveMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayResolveMs));
      }

      if (decision === "allow_once") {
        state.phase = "approved_once";
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schema_version: "tool_approval.v1",
            approval: {
              ...pendingSnapshot(),
              state: "approved_once",
              revision: 2,
            },
            redaction: "metadata_only",
          }),
        });
      } else {
        state.phase = "denied";
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            schema_version: "tool_approval.v1",
            approval: {
              ...pendingSnapshot(),
              state: "denied",
              revision: 2,
              terminal_at_ms: Date.now() + 5000,
              terminal_code: "approval_denied",
            },
            redaction: "metadata_only",
          }),
        });
      }
      return;
    }

    state.detailCalls += 1;
    if (state.phase === "pending") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schema_version: "tool_approval.v1",
          approval: pendingSnapshot(),
          redaction: "metadata_only",
        }),
      });
    } else if (state.phase === "approved_once") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schema_version: "tool_approval.v1",
          approval: {
            ...pendingSnapshot(),
            state: "approved_once",
            revision: 2,
          },
          redaction: "metadata_only",
        }),
      });
    } else if (state.phase === "denied") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schema_version: "tool_approval.v1",
          approval: {
            ...pendingSnapshot(),
            state: "denied",
            revision: 2,
            terminal_at_ms: Date.now() + 5000,
            terminal_code: "approval_denied",
          },
          redaction: "metadata_only",
        }),
      });
    } else {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
  });

  await page.routeWebSocket("ws://127.0.0.1:18791/ws", async (socket) => {
    state.activeSocket = socket;
    socket.onMessage((raw) => {
      const request = JSON.parse(String(raw)) as {
        id: string;
        method: string;
        params: Record<string, unknown>;
      };
      const respond = (data: unknown) =>
        socket.send(JSON.stringify({ type: "res", version: "v1", id: request.id, ok: true, data }));

      if (request.method === "connect") {
        respond({ session_id: SESSION_ID, agent: "default", version: "0.2.0" });
      } else if (request.method === "sessions.list") {
        respond({
          sessions: [
            { id: SESSION_ID, channel: "web", status: "active", started_at: 1, updated_at: 1 },
          ],
        });
      } else if (request.method === "chat.history") {
        respond({ messages: [] });
      } else if (request.method === "chat.send") {
        state.phase = "pending";
        state.pendingChatSendResolve = respond;

        // Emit run.started
        socket.send(
          JSON.stringify({
            type: "event",
            version: "v1",
            event: "run.started",
            session_id: SESSION_ID,
            run_id: RUN_ID,
            payload: { run_id: RUN_ID },
          })
        );

        // Emit tool_approval.updated hint
        socket.send(
          JSON.stringify({
            type: "event",
            version: "v1",
            event: "tool_approval.updated",
            session_id: SESSION_ID,
            run_id: RUN_ID,
            payload: {
              approval_id: APPROVAL_ID,
              tool_call_id: TOOL_CALL_ID,
              tool_name: "shell",
              state: "pending",
              revision: 1,
              redaction: "metadata_only",
              snapshot_refetch_required: true,
            },
          })
        );
      }
    });
  });

  return {
    state,
    resumeAfterAllow: () => {
      state.toolCallsEmitted.push(TOOL_CALL_ID);
      state.activeSocket?.send(
        JSON.stringify({
          type: "event",
          version: "v1",
          event: "tool.started",
          session_id: SESSION_ID,
          run_id: RUN_ID,
          payload: { id: TOOL_CALL_ID, name: "shell", args: {} },
        })
      );
      state.activeSocket?.send(
        JSON.stringify({
          type: "event",
          version: "v1",
          event: "tool.finished",
          session_id: SESSION_ID,
          run_id: RUN_ID,
          payload: { id: TOOL_CALL_ID, name: "shell", result: "package.json\nsrc" },
        })
      );
      state.activeSocket?.send(
        JSON.stringify({
          type: "event",
          version: "v1",
          event: "run.finished",
          session_id: SESSION_ID,
          run_id: RUN_ID,
          payload: {
            run_id: RUN_ID,
            content: "Finished executing ls: found package.json and src.",
            tool_calls_made: 1,
            lifecycle_status: "completed",
          },
        })
      );
      state.pendingChatSendResolve?.({
        content: "Finished executing ls: found package.json and src.",
        tool_calls_made: 1,
      });
    },
    resumeAfterDeny: () => {
      // Do NOT emit any tool execution event
      state.activeSocket?.send(
        JSON.stringify({
          type: "event",
          version: "v1",
          event: "run.finished",
          session_id: SESSION_ID,
          run_id: RUN_ID,
          payload: {
            run_id: RUN_ID,
            content: "Tool execution was denied: approval_denied",
            tool_calls_made: 0,
            lifecycle_status: "completed",
          },
        })
      );
      state.pendingChatSendResolve?.({
        content: "Tool execution was denied: approval_denied",
        tool_calls_made: 0,
      });
    },
    resumeAfterExpiration: () => {
      state.phase = "denied";
      state.activeSocket?.send(
        JSON.stringify({
          type: "event",
          version: "v1",
          event: "tool_approval.updated",
          session_id: SESSION_ID,
          run_id: RUN_ID,
          payload: {
            approval_id: APPROVAL_ID,
            tool_call_id: TOOL_CALL_ID,
            tool_name: "shell",
            state: "expired",
            revision: 2,
          },
        })
      );
      state.activeSocket?.send(
        JSON.stringify({
          type: "event",
          version: "v1",
          event: "run.finished",
          session_id: SESSION_ID,
          run_id: RUN_ID,
          payload: {
            run_id: RUN_ID,
            content: "Error: tool approval failed: approval_expired",
            tool_calls_made: 0,
            lifecycle_status: "completed",
          },
        })
      );
      state.pendingChatSendResolve?.({
        content: "Error: tool approval failed: approval_expired",
        tool_calls_made: 0,
      });
    },
  };
}

test("executes Allow Once approval flow: sends CAS mutation, disables duplicate click, resumes turn", async ({
  page,
}) => {
  const fixture = await installG4Fixture(page, { delayResolveMs: 300 });
  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();

  const composer = page.getByPlaceholder("Message nonclaw...");
  await composer.fill("run ls in workspace");
  await page.getByRole("button", { name: "Send" }).click();

  // 1. Tool approval required card appears with correct fields
  await expect(page.getByRole("heading", { name: "Tool approval required" })).toBeVisible();
  await expect(page.getByText("shell.execute")).toBeVisible();
  await expect(page.getByText("Risk: High")).toBeVisible();
  await expect(page.getByText("ls", { exact: true })).toBeVisible();
  await expect(page.getByText("1", { exact: true })).toBeVisible();
  await expect(page.getByText("workspace_root", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Allow Once authorizes one attempt of this exact operation. Deny rejects it.")
  ).toBeVisible();

  // 2. Composer is blocked
  await expect(composer).toBeDisabled();

  // 3. Click Allow Once twice to prove duplicate click is ignored while in-flight
  const allowOnceButton = page.getByRole("button", { name: "Allow Once" });
  const denyButton = page.getByRole("button", { name: "Deny" });
  await allowOnceButton.click();
  // Immediate second click attempt while in-flight
  await allowOnceButton.click({ force: true }).catch(() => undefined);

  // 4. Assert exact mutation POST body and exactly ONE resolve call
  await expect.poll(() => fixture.state.resolveCalls).toBe(1);
  expect(fixture.state.lastResolveBody).toEqual({
    expected_revision: 1,
    decision: "allow_once",
  });

  // Buttons become disabled immediately
  await expect(allowOnceButton).toBeDisabled();
  await expect(denyButton).toBeDisabled();

  // 5. Resume execution via WS
  fixture.resumeAfterAllow();

  // 6. Card disappears
  await expect(page.getByRole("heading", { name: "Tool approval required" })).not.toBeVisible();

  // 7. Output completes
  await expect(page.getByText("Finished executing ls: found package.json and src.")).toBeVisible();
  await expect(composer).toBeEnabled();

  // Bounded list calls assertion
  expect(fixture.state.listCalls).toBeLessThanOrEqual(5);
});

test("executes Deny approval flow: sends deny decision, skips tool execution, finishes with safe outcome", async ({
  page,
}) => {
  const fixture = await installG4Fixture(page);
  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();

  const composer = page.getByPlaceholder("Message nonclaw...");
  await composer.fill("run ls in workspace");
  await page.getByRole("button", { name: "Send" }).click();

  // 1. Tool approval required card appears
  await expect(page.getByRole("heading", { name: "Tool approval required" })).toBeVisible();
  await expect(composer).toBeDisabled();

  // 2. Click Deny
  const denyButton = page.getByRole("button", { name: "Deny" });
  await denyButton.click();

  // 3. Assert exact mutation POST body
  expect(fixture.state.resolveCalls).toBe(1);
  expect(fixture.state.lastResolveBody).toEqual({
    expected_revision: 1,
    decision: "deny",
  });

  // 4. Resume via Deny outcome
  fixture.resumeAfterDeny();

  // 5. Assert no tool calls were emitted
  expect(fixture.state.toolCallsEmitted).toHaveLength(0);

  // 6. Card disappears
  await expect(page.getByRole("heading", { name: "Tool approval required" })).not.toBeVisible();

  // 7. Outcome text appears
  await expect(page.getByText("Tool execution was denied: approval_denied")).toBeVisible();
  await expect(composer).toBeEnabled();

  // Bounded list calls assertion
  expect(fixture.state.listCalls).toBeLessThanOrEqual(5);
});

test("handles approval expiration: card disappears, failure text renders, composer unblocks", async ({
  page,
}) => {
  const fixture = await installG4Fixture(page);
  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();

  const composer = page.getByPlaceholder("Message nonclaw...");
  await composer.fill("run uname -a in workspace");
  await page.getByRole("button", { name: "Send" }).click();

  // 1. Tool approval required card appears
  await expect(page.getByRole("heading", { name: "Tool approval required" })).toBeVisible();
  await expect(composer).toBeDisabled();

  // 2. Expiration occurs
  fixture.resumeAfterExpiration();

  // 3. Card disappears
  await expect(page.getByRole("heading", { name: "Tool approval required" })).not.toBeVisible();

  // 4. Expiration error text appears and composer is re-enabled
  await expect(page.getByText("Error: tool approval failed: approval_expired")).toBeVisible();
  await expect(composer).toBeEnabled();
});
