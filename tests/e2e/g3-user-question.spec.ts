async function installG3Fixture(page: Page, options: G3FixtureOptions = {}) {
  return {
    sendHint: (hint: Record<string, unknown> = {}) => {
      state.activeSocket?.send(
        JSON.stringify({
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

test("does not refocus a live question when reconnect changes its sync status", async ({
  page,
}) => {
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
}) => {
});
