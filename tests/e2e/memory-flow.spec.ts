import { expect, test } from "@playwright/test";

test("real daemon memory lifecycle", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nonclaw-daemon-url", "http://127.0.0.1:18791");
    localStorage.removeItem("nonclaw-session-id");
    localStorage.removeItem("nonclaw-chat-messages");
  });
  await page.goto("/");
  await expect(page.getByText("connected")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: "Memory" }).click();
  await page.getByLabel("Memory key").fill("ui-key");
  await page.getByLabel("Memory value").fill('{"language":"Rust"}');
  await page.getByRole("button", { name: "Save memory" }).click();
  await expect(page.getByText('{"language":"Rust"}')).toBeVisible();

  await page.getByLabel("Search working memory").fill("ui-key");
  await page.getByRole("button", { name: "Edit memory key ui-key" }).click();
  await page.getByLabel("Memory value").fill('"Go"');
  await page.getByRole("button", { name: "Save memory" }).click();
  await expect(page.getByText("Go")).toBeVisible();
  await page.getByRole("button", { name: "Delete memory key ui-key" }).click();
  await expect(page.getByText("No working memories")).toBeVisible();

  await page.getByRole("link", { name: "Chat" }).click();
  const message = page.getByPlaceholder("Message nonclaw...");
  await message.fill("!remember chat-key chat-value");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Remembered: chat-key = chat-value")).toBeVisible();
  await message.fill("!recall chat-key");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/chat-key: chat-value/)).toBeVisible();

  const sessionLabel = page.getByText(/^Session:/);
  const initialSession = await sessionLabel.textContent();
  await page.getByRole("button", { name: "New chat" }).click();
  await expect.poll(() => sessionLabel.textContent()).not.toBe(initialSession);
  await expect(page.getByText(/chat-key: chat-value/)).not.toBeVisible();

  await message.fill("I prefer Rust");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Memory updated: episode saved, 1 derived facts")).toBeVisible();

  await page.getByRole("link", { name: "Memory" }).click();
  const episode = page.getByTestId(/^episode-/).first();
  await expect(episode.getByText(/prefers Rust/)).toBeVisible();
  await episode.getByLabel(/input$/).fill("I prefer Go");
  await episode.getByRole("button", { name: "Save transcript" }).click();
  await expect(episode.getByText(/prefers Go/)).toBeVisible();
  await episode.getByLabel(/input$/).fill("my api key is secret");
  await episode.getByRole("button", { name: "Save transcript" }).click();
  await expect(episode.getByText(/Sensitive transcript edits are rejected/)).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await episode.getByRole("button", { name: "Delete episode" }).click();
  await expect(page.getByText(/prefers Go/)).not.toBeVisible();
});
