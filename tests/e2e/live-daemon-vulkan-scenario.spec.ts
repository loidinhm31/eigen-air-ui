import { expect, test } from "@playwright/test";

test.describe("Live Vulkan Daemon E2E Scenarios", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("eigen-air-daemon-url", "http://127.0.0.1:18790");
      localStorage.setItem(
        "eigen-air-auth-token",
        "7f59e58b5014618010a76843dc864b424e02f0bcb219676bb3b57a9d5394ab0d"
      );
      localStorage.removeItem("eigen-air-session-id");
      localStorage.removeItem("eigen-air-chat-messages");
    });
  });

  test("scenario 1: connects to live daemon and completes basic chat turn", async ({ page }) => {
    await page.goto("/");

    // 1. Verify connection to live daemon
    await expect(page.getByText("connected", { exact: true })).toBeVisible({ timeout: 20_000 });

    // 2. Check composer is ready
    const composer = page.getByPlaceholder("Message eigen-air...");
    await expect(composer).toBeEnabled();

    // 3. Send greeting
    await composer.fill("Hello! Reply with exactly 'Hello from local llama' and nothing else.");
    await page.getByRole("button", { name: "Send" }).click();

    // 4. Verify message appears in chat
    await expect(page.getByText("Hello! Reply with exactly 'Hello from local llama' and nothing else.")).toBeVisible();

    // 5. Verify response streams and composer returns to enabled
    await expect(composer).toBeEnabled({ timeout: 60_000 });

    // 6. Verify assistant response was received in chat
    const assistantBubble = page.locator(".bg-secondary").first();
    await expect(assistantBubble).toBeVisible();
    const responseText = await assistantBubble.textContent();
    console.log("Assistant basic chat response:", responseText);
    expect(responseText?.trim().length).toBeGreaterThan(0);
  });

  test("scenario 2: triggers tool call, renders tool approval card, approves and completes turn", async ({ page }) => {
    await page.goto("/");

    // 1. Verify connection
    await expect(page.getByText("connected", { exact: true })).toBeVisible({ timeout: 20_000 });

    const composer = page.getByPlaceholder("Message eigen-air...");
    await expect(composer).toBeEnabled();

    // 2. Send prompt requiring shell tool execution (uname -a)
    await composer.fill("Run the shell command: uname -a");
    await page.getByRole("button", { name: "Send" }).click();

    // 3. Tool Approval Card MUST render in UI (previously hung / approval expired bug)
    console.log("Waiting for tool approval card to render in UI...");
    const allowButton = page.getByRole("button", { name: "Allow Once" });
    await expect(allowButton).toBeVisible({ timeout: 60_000 });

    // Verify card content
    const heading = page.getByRole("heading", { name: /Tool Approval Required|Security Approval/i });
    if (await heading.isVisible()) {
      console.log("Approval heading visible:", await heading.textContent());
    }

    // 4. Click 'Allow Once' to approve execution
    console.log("Clicking 'Allow Once' button...");
    await allowButton.click();

    // 5. Verify composer becomes enabled again after turn completes
    await expect(composer).toBeEnabled({ timeout: 60_000 });

    // 6. Verify Linux / uname output is shown in response or tool call card
    const chatContent = await page.locator("main").textContent();
    console.log("Chat content after approval:", chatContent);
    expect(chatContent?.toLowerCase()).toMatch(/linux|x86_64|gnu/);
  });
  test("scenario 3: triggers tool call, renders tool approval card, denies and completes turn safely", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("connected", { exact: true })).toBeVisible({ timeout: 20_000 });

    const composer = page.getByPlaceholder("Message eigen-air...");
    await expect(composer).toBeEnabled();

    // Send prompt requiring shell tool
    await composer.fill("Run the shell command: date");
    await page.getByRole("button", { name: "Send" }).click();

    // Wait for tool approval card
    const denyButton = page.getByRole("button", { name: "Deny" });
    await expect(denyButton).toBeVisible({ timeout: 60_000 });

    // Click Deny
    console.log("Clicking 'Deny' button...");
    await denyButton.click();

    // Verify composer returns to enabled state without hang
    await expect(composer).toBeEnabled({ timeout: 60_000 });
    console.log("Turn completed after denial; composer re-enabled.");
  });
});
