import { expect, test, type Page } from "@playwright/test";

const SESSION = {
  id: "g1-e2e-session",
  channel: "web",
  status: "active",
  started_at: 1,
  updated_at: 1,
};

const HOSTILE_MARKDOWN = [
  "# Safe heading",
  "",
  "| feature | status |",
  "| --- | --- |",
  "| GFM | safe |",
  "",
  "```ts",
  "const safe = true;",
  "```",
  "",
  "[unsafe link](javascript:alert(1))",
  "![tracking pixel](https://evil.example/pixel.png)",
  '<img src="https://evil.example/raw.png" onerror="alert(1)">',
].join("\n");

async function installDeterministicChatFixture(page: Page) {
  const sentChatParams: Array<Record<string, unknown>> = [];

  await page.addInitScript((sessionId) => {
    localStorage.setItem("nonclaw-daemon-url", "http://127.0.0.1:18791");
    localStorage.setItem("nonclaw-session-id", sessionId);
    localStorage.removeItem("nonclaw-chat-messages");
  }, SESSION.id);

  await page.route("**/v1/skills", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "stale-skill", name: "Stale skill", description: "Unavailable fixture skill" },
      ]),
    });
  });

  await page.routeWebSocket("ws://127.0.0.1:18791/ws", async (socket) => {
    socket.onMessage((raw) => {
      const request = JSON.parse(String(raw)) as {
        id: string;
        method: string;
        params: Record<string, unknown>;
      };
      const respond = (data: unknown) =>
        socket.send(JSON.stringify({ type: "res", id: request.id, ok: true, data }));

      if (request.method === "connect") {
        respond({ session_id: SESSION.id, agent: "default", version: "0.2.0" });
      } else if (request.method === "sessions.list") {
        respond({ sessions: [SESSION] });
      } else if (request.method === "chat.history") {
        respond({ messages: [{ role: "assistant", content: HOSTILE_MARKDOWN }] });
      } else if (request.method === "chat.send") {
        sentChatParams.push(request.params);
        if (request.params.selected_skill_id === "stale-skill") {
          socket.send(
            JSON.stringify({
              type: "res",
              id: request.id,
              ok: false,
              error: {
                code: "selected_skill_unavailable",
                message:
                  "Selected skill is unavailable. Refresh the skill list or remove the selection.",
              },
            })
          );
          return;
        }

        socket.send(
          JSON.stringify({
            type: "event",
            event: "tool.started",
            payload: { id: "future-tool-1", name: "future_tool", args: { query: "safe" } },
          })
        );
        socket.send(
          JSON.stringify({
            type: "event",
            event: "tool.finished",
            payload: { id: "future-tool-1", name: "future_tool", result: "not-json" },
          })
        );
        respond({ content: "fixture complete", tool_calls_made: 1 });
      }
    });
  });

  return sentChatParams;
}

test("renders hostile Markdown without network or executable UI and keeps unknown tools visible", async ({
  page,
}) => {
  const evilRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("evil.example")) evilRequests.push(request.url());
  });
  await installDeterministicChatFixture(page);

  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Safe heading" })).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("const safe = true;")).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "unsafe link" })).toHaveCount(0);
  expect(evilRequests).toEqual([]);

  await page.getByPlaceholder("Message nonclaw...").fill("exercise unknown tool");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: /future_tool/ }).click();
  await expect(page.getByTestId("generic-tool-renderer")).toContainText("result (unparsed text)");
});

test("stale selected skill fails visibly and sends stable ID without instruction fields", async ({
  page,
}) => {
  const sentChatParams = await installDeterministicChatFixture(page);
  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open commands and skills" }).click();
  await page.getByRole("option", { name: /Stale skill/ }).click();
  await page.getByPlaceholder("Message nonclaw...").fill("ordinary request");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText(/Selected skill is unavailable/)).toBeVisible();
  expect(sentChatParams).toHaveLength(1);
  expect(sentChatParams[0]).toMatchObject({ selected_skill_id: "stale-skill" });
  expect(sentChatParams[0]).not.toHaveProperty("prompt");
  expect(sentChatParams[0]).not.toHaveProperty("template");
  expect(sentChatParams[0]).not.toHaveProperty("instructions");
});
