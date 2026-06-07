import { expect, test } from "@playwright/test";

test("restores and continues persisted sessions across reconnects", async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("nonclaw-e2e-session-resume-init")) {
      return;
    }
    localStorage.setItem("nonclaw-daemon-url", "http://127.0.0.1:18791");
    localStorage.removeItem("nonclaw-session-id");
    localStorage.removeItem("nonclaw-chat-messages");
    sessionStorage.setItem("nonclaw-e2e-session-resume-init", "1");
  });

  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible({ timeout: 30_000 });

  const messageInput = page.getByPlaceholder("Message nonclaw...");
  const sessionLabel = page.getByText(/^Session:/);

  const initialSession = await sessionLabel.textContent();
  const initialSessionId = initialSession?.replace(/^Session:\s*/, "").trim() ?? "";
  await messageInput.fill("restore this session");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("restore this session")).toBeVisible();
  await expect(page.getByText("stub response")).toBeVisible();

  await page.getByRole("button", { name: "New chat" }).click();
  await expect.poll(() => sessionLabel.textContent()).not.toBe(initialSession);
  const secondSession = await sessionLabel.textContent();
  const secondSessionId = secondSession?.replace(/^Session:\s*/, "").trim() ?? "";
  await expect(page.getByText("restore this session")).not.toBeVisible();

  await messageInput.fill("second session only");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("second session only")).toBeVisible();

  await page.getByRole("link", { name: "Sessions" }).click();
  await expect(
    page.getByTestId(`session-${initialSessionId}`).getByRole("button", { name: "Open" })
  ).toBeVisible();
  await expect(
    page.getByTestId(`session-${secondSessionId}`).getByRole("button", { name: "Open" })
  ).toBeVisible();
  await page
    .getByTestId(`session-${initialSessionId}`)
    .getByRole("button", { name: "Open" })
    .click();

  await expect(page.getByRole("link", { name: "Chat" })).toBeVisible();
  await expect(sessionLabel).toContainText(initialSessionId);
  await expect(page.getByText("restore this session")).toBeVisible();
  await expect(page.getByText("second session only")).not.toBeVisible();

  await messageInput.fill("continue restored session");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("continue restored session")).toBeVisible();

  await page.reload();
  await expect(page.getByText("connected", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(sessionLabel).toContainText(initialSessionId);
  await expect(page.getByText("restore this session")).toBeVisible();
  await expect(page.getByText("continue restored session")).toBeVisible();

  await page.getByRole("link", { name: "Sessions" }).click();
  await page
    .getByTestId(`session-${initialSessionId}`)
    .getByRole("button", { name: "Delete" })
    .click();

  await page.getByRole("link", { name: "Chat" }).click();
  await expect.poll(() => sessionLabel.textContent()).not.toBe(initialSession);
  await expect(sessionLabel).not.toContainText(initialSessionId);
  await expect(page.getByText("restore this session")).not.toBeVisible();
  await expect(page.getByText("continue restored session")).not.toBeVisible();
  await expect(page.getByText("second session only")).not.toBeVisible();
  await expect(sessionLabel).not.toContainText(secondSessionId);
});
