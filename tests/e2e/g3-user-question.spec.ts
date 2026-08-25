import { expect, test, type Page } from "@playwright/test";

const SESSION_ID = "g3-question-session";
const QUESTION_ID = "g3-question-1";
const RUN_ID = "g3-run-1";
const MUTATION_TOKEN = "a".repeat(32);
const PROMPT = "What should the note say?";

type Phase = "empty" | "pending" | "answered" | "continuing" | "resolved" | "expired";

interface G3FixtureOptions {
  initialPhase?: Phase;
  sendStartsQuestion?: boolean;
}

interface G3FixtureState {
  phase: Phase;
  listCalls: number;
  detailCalls: number;
  historyCalls: number;
  runCalls: number;
  sendCalls: number;
  resolveCalls: number;
  resolveStatus: 202 | 409;
  lastMutationBody?: Record<string, unknown>;
  order: string[];
  offline: boolean;
  historyContent: string;
  activeSocket?: { close: () => void; send: (message: string) => void };
}

function metadata(state: G3FixtureState) {
  return {
    schema_version: "user_question.v1",
    question_id: QUESTION_ID,
    tenant_id: "tenant-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    session_id: SESSION_ID,
    run_id: RUN_ID,
    turn_index: 1,
    state: state.phase === "expired" ? "expired" : state.phase,
    revision: state.phase === "pending" ? 1 : 2,
    created_at_ms: 1,
    expires_at_ms: 2,
    terminal_at_ms: state.phase === "expired" ? 3 : null,
    redaction: "metadata_only",
  } as const;
}

function detail(state: G3FixtureState) {
  return {
    ...metadata(state),
    request: { kind: "short_text", prompt: PROMPT },
    mutation_token: MUTATION_TOKEN,
  } as const;
}

function runSnapshot() {
  return {
    schema_version: 1,
    run: {
      run_id: RUN_ID,
      trace_id: "g3-trace-1",
      session_id: SESSION_ID,
      root_run_id: RUN_ID,
      tenant_id: "tenant-1",
      user_id: "user-1",
      workspace_id: "workspace-1",
      agent_id: "agent-1",
      provider_id: "provider-1",
      channel: "web",
      lifecycle_status: "running",
      started_at_ms: 1,
      updated_at_ms: 1,
      snapshot_seq: 1,
      correlation_state: "active",
      redaction: { metadata_only: true, debug_requested: false, debug_available: false },
    },
    events: [],
    tool_calls: [],
    memory_lineage: [],
  };
}

async function installG3Fixture(page: Page, options: G3FixtureOptions = {}) {
  const state: G3FixtureState = {
    phase: options.initialPhase ?? "pending",
    listCalls: 0,
    detailCalls: 0,
    historyCalls: 0,
    runCalls: 0,
    sendCalls: 0,
    resolveCalls: 0,
    resolveStatus: 202,
    order: [],
    offline: false,
    historyContent: "",
  };

  await page.addInitScript((sessionId) => {
    localStorage.setItem("nonclaw-daemon-url", "http://127.0.0.1:18791");
    localStorage.setItem("nonclaw-session-id", sessionId);
    localStorage.removeItem("nonclaw-chat-messages");
  }, SESSION_ID);

  await page.route("**/v1/skills", (route) => route.fulfill({ json: [] }));
  await page.route("**/v1/runs/**", async (route) => {
    state.runCalls += 1;
    state.order.push("run");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...runSnapshot(),
      }),
    });
  });
  await page.route("**/v1/user-questions**", async (route) => {
    if (state.offline) {
      await route.abort();
      return;
    }
    const request = route.request();
    const url = new URL(request.url());
    const segments = url.pathname.split("/").filter(Boolean);
    const questionIndex = segments.indexOf("user-questions");
    const suffix = segments.slice(questionIndex + 1);
    const questionId = suffix[0];

    if (!questionId) {
      state.listCalls += 1;
      state.order.push("list");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schema_version: "user_question.v1",
          questions:
            state.phase === "pending" || state.phase === "answered" || state.phase === "continuing"
              ? [metadata(state)]
              : [],
          redaction: "metadata_only",
        }),
      });
      return;
    }

    if (suffix[1] === "resolve") {
      state.resolveCalls += 1;
      state.lastMutationBody = JSON.parse(request.postData() ?? "{}");
      if (state.resolveStatus === 409) {
        await route.fulfill({ status: 409, contentType: "application/json", body: "{}" });
        return;
      }
      state.phase = "answered";
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          schema_version: "user_question.v1",
          question: { ...metadata(state), state: "answered", revision: 2, terminal_at_ms: null },
          status: "accepted",
        }),
      });
      return;
    }

    if (suffix[1] === "cancel") {
      state.phase = "resolved";
      state.historyContent = "cancelled";
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          schema_version: "user_question.v1",
          question: { ...metadata(state), state: "cancelled", revision: 2, terminal_at_ms: 3 },
          status: "accepted",
        }),
      });
      return;
    }

    state.detailCalls += 1;
    state.order.push("detail");
    if (state.phase === "resolved" || state.phase === "expired" || state.phase === "empty") {
      await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return;
    }
    if (state.phase !== "pending") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(metadata(state)),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(detail(state)),
    });
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
      } else if (request.method === "sessions.create") {
        respond({
          id: "g3-new-session",
          channel: "web",
          status: "active",
          started_at: 1,
          updated_at: 1,
        });
      } else if (request.method === "chat.history") {
        state.historyCalls += 1;
        state.order.push("history");
        respond({
          messages: state.historyContent
            ? [{ role: "assistant", content: state.historyContent }]
            : [],
        });
      } else if (request.method === "chat.send") {
        state.sendCalls += 1;
        if (options.sendStartsQuestion) {
          state.phase = "pending";
          respond({
            status: "waiting_for_input",
            run_id: RUN_ID,
            question_id: QUESTION_ID,
            snapshot_ref: `user_question:${QUESTION_ID}`,
          });
          socket.send(
            JSON.stringify({
              type: "event",
              version: "v1",
              event: "user_question.updated",
              session_id: SESSION_ID,
              run_id: RUN_ID,
              payload: { question_id: QUESTION_ID, state: "pending", revision: 1 },
            })
          );
        } else {
          respond({ content: "done", tool_calls_made: 0 });
        }
      }
    });
  });

  return {
    state,
    closeActiveSocket: () => state.activeSocket?.close(),
    sendRunFinished: () =>
      state.activeSocket?.send(
        JSON.stringify({
          type: "event",
          version: "v1",
          event: "run.finished",
          session_id: SESSION_ID,
          run_id: RUN_ID,
          payload: {
            run_id: RUN_ID,
            content: "resolved elsewhere",
            tool_calls_made: 0,
            lifecycle_status: "completed",
            snapshot_refetch_required: true,
          },
        })
      ),
    completeContinuation: (content = "resumed answer") => {
      state.phase = "resolved";
      state.historyContent = content;
      state.activeSocket?.send(
        JSON.stringify({
          type: "event",
          version: "v1",
          event: "user_question.updated",
          session_id: SESSION_ID,
          run_id: RUN_ID,
          payload: { question_id: QUESTION_ID, state: "resolved", revision: 3 },
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
            content,
            tool_calls_made: 0,
            lifecycle_status: "completed",
            snapshot_refetch_required: true,
          },
        })
      );
    },
    sendHint: (hint: Record<string, unknown> = {}) => {
      const {
        event_id,
        event_seq,
        occurred_at_ms,
        request_id,
        trace_id,
        parent_run_id,
        root_run_id,
        ...payload
      } = hint;
      state.activeSocket?.send(
        JSON.stringify({
          type: "event",
          version: "v1",
          event: "user_question.updated",
          session_id: SESSION_ID,
          run_id: RUN_ID,
          ...(event_id === undefined ? {} : { event_id }),
          ...(event_seq === undefined ? {} : { event_seq }),
          ...(occurred_at_ms === undefined ? {} : { occurred_at_ms }),
          ...(request_id === undefined ? {} : { request_id }),
          ...(trace_id === undefined ? {} : { trace_id }),
          ...(parent_run_id === undefined ? {} : { parent_run_id }),
          ...(root_run_id === undefined ? {} : { root_run_id }),
          payload: { question_id: QUESTION_ID, state: "pending", revision: 1, ...payload },
        })
      );
    },
  };
}

async function openQuestion(page: Page) {
  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agent question" })).toBeVisible();
  await expect(page.getByLabel(PROMPT)).toBeEnabled();
}

test("keeps a question alive after chat.send completes and only blocks its composer", async ({
  page,
}) => {
  const fixture = await installG3Fixture(page, { initialPhase: "empty", sendStartsQuestion: true });
  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();

  const composer = page.getByPlaceholder("Message nonclaw...");
  await composer.fill("start question");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("heading", { name: "Agent question" })).toBeVisible();
  await expect(composer).toBeDisabled();
  await expect(page.getByRole("button", { name: "New chat" })).toBeEnabled();
  expect(fixture.state.sendCalls).toBe(1);
  expect(fixture.state.order.indexOf("history")).toBeLessThan(
    fixture.state.order.indexOf("detail")
  );
});

test("does not refocus a live question when reconnect changes its sync status", async ({ page }) => {
  const fixture = await installG3Fixture(page, { initialPhase: "empty", sendStartsQuestion: true });
  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await page.getByPlaceholder("Message nonclaw...").fill("start question");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("heading", { name: "Agent question" })).toBeVisible();

  const navigationControl = page.getByRole("button", { name: "New chat" });
  await navigationControl.focus();
  const listCallsBeforeReconnect = fixture.state.listCalls;
  fixture.closeActiveSocket();
  await expect
    .poll(() => fixture.state.listCalls, { timeout: 15_000 })
    .toBeGreaterThan(listCallsBeforeReconnect);
  await expect(navigationControl).toBeFocused();
});

test("reconnects without stealing focus and refetches question, run, and history snapshots", async ({
  page,
}) => {
  const fixture = await installG3Fixture(page);
  await openQuestion(page);
  const navigationControl = page.getByRole("button", { name: "New chat" });
  await navigationControl.focus();
  await expect(navigationControl).toBeFocused();
  const listCallsBeforeReconnect = fixture.state.listCalls;
  const historyCallsBeforeReconnect = fixture.state.historyCalls;
  fixture.closeActiveSocket();
  await expect(navigationControl).toBeFocused();

  await expect
    .poll(() => fixture.state.listCalls, { timeout: 15_000 })
    .toBeGreaterThan(listCallsBeforeReconnect);
  await expect
    .poll(() => fixture.state.historyCalls, { timeout: 15_000 })
    .toBeGreaterThan(historyCallsBeforeReconnect);
  await expect(page.getByRole("heading", { name: "Agent question" })).toBeVisible();
  await expect(navigationControl).toBeFocused();

  const listCallsBeforeReload = fixture.state.listCalls;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Agent question" })).toBeVisible();
  await expect.poll(() => fixture.state.listCalls).toBeGreaterThan(listCallsBeforeReload);
});

test("treats duplicate/gapped refetch hints as non-authoritative and clears a resolved-elsewhere question", async ({
  page,
}) => {
  const fixture = await installG3Fixture(page);
  await openQuestion(page);
  const listCallsBeforeHint = fixture.state.listCalls;
  fixture.sendHint({ event_seq: 99, snapshot_refetch_required: true });
  await expect.poll(() => fixture.state.listCalls).toBeGreaterThan(listCallsBeforeHint);

  fixture.state.phase = "resolved";
  fixture.state.historyContent = "resolved elsewhere";
  fixture.sendHint({ event_seq: 100 });
  fixture.sendRunFinished();
  await expect(page.getByRole("heading", { name: "Agent question" })).not.toBeVisible();
  await expect(page.getByText("resolved elsewhere")).toBeVisible();
  await expect(page.getByPlaceholder("Message nonclaw...")).toBeEnabled();
});

test("keeps the card disabled while offline, then reconciles after service recovery", async ({
  page,
}) => {
  const fixture = await installG3Fixture(page);
  await openQuestion(page);
  fixture.state.offline = true;
  fixture.sendHint({ snapshot_refetch_required: true });
  await expect(page.getByRole("status")).toContainText(
    "Reconnecting; checking current question state"
  );
  await expect(page.getByLabel(PROMPT)).toBeDisabled();

  fixture.state.offline = false;
  fixture.sendHint({ snapshot_refetch_required: true });
  await expect(page.getByLabel(PROMPT)).toBeEnabled();
});

test("clears an expired question through the authoritative snapshot", async ({ page }) => {
  const fixture = await installG3Fixture(page);
  await openQuestion(page);
  fixture.state.phase = "expired";
  fixture.sendHint({ state: "expired", revision: 2, event_seq: 12 });
  await expect(page.getByRole("heading", { name: "Agent question" })).not.toBeVisible();
  await expect(page.getByPlaceholder("Message nonclaw...")).toBeEnabled();
});

test("rejects a stale submit through reconciliation without optimistic terminal UI", async ({
  page,
}) => {
  const fixture = await installG3Fixture(page);
  await openQuestion(page);
  fixture.state.resolveStatus = 409;
  await page.getByLabel(PROMPT).fill("stale answer");
  await page.getByRole("button", { name: "Answer" }).click();
  await expect(page.getByRole("heading", { name: "Agent question" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("changed or was already answered");
  expect(fixture.state.resolveCalls).toBe(1);
  expect(fixture.state.lastMutationBody).toMatchObject({
    expected_revision: 1,
    mutation_token: MUTATION_TOKEN,
    answer: { kind: "short_text", text: "stale answer" },
  });
});

test("returns focus after an accepted cancel clears the question", async ({ page }) => {
  await installG3Fixture(page);
  await openQuestion(page);
  const composer = page.getByPlaceholder("Message nonclaw...");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Agent question" })).not.toBeVisible();
  await expect(page.getByText("cancelled")).toBeVisible();
  await expect(composer).toBeFocused();
});

test("sends one resolve mutation and returns focus only after accepted submission", async ({
  page,
}) => {
  const fixture = await installG3Fixture(page);
  await openQuestion(page);
  await page.getByLabel(PROMPT).fill("one answer");
  await page.getByRole("button", { name: "Answer" }).dblclick();
  await expect.poll(() => fixture.state.phase).toBe("answered");
  await expect(page.getByTestId("pending-question-region")).toHaveAttribute(
    "data-question-state",
    "answered"
  );
  await expect(page.getByRole("status")).toContainText("agent is resuming");
  await expect(page.getByPlaceholder("Message nonclaw...")).toBeDisabled();
  fixture.completeContinuation();
  await expect(page.getByRole("heading", { name: "Agent question" })).not.toBeVisible();
  await expect(page.getByText("resumed answer")).toBeVisible();
  await expect(page.getByText("resumed answer")).toBeVisible();
  expect(fixture.state.resolveCalls).toBe(1);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute("placeholder")))
    .toBe("Message nonclaw...");
});
