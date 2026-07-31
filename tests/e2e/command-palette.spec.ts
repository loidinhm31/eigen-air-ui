import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nonclaw-daemon-url", "http://127.0.0.1:18791");
    localStorage.removeItem("nonclaw-session-id");
    localStorage.removeItem("nonclaw-chat-messages");
  });
  await page.route("**/v1/skills", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "code_review",
          name: "Code review",
          description: "Review code without exposing server instructions",
          tags: ["review"],
        },
      ]),
    });
  });
});

test("selects a skill by keyboard and sends only its stable ID", async ({ page }) => {
  const sentFrames: string[] = [];
  page.on("websocket", (socket) => {
    socket.on("framesent", (event) => {
      if (typeof event.payload === "string") sentFrames.push(event.payload);
    });
  });

  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Open commands and skills" }).click();
  const palette = page.getByRole("combobox", {
    name: "Search commands and installed skills",
  });
  await expect(palette).toBeFocused();
  await palette.fill("code review");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Skill: Code review")).toBeVisible();
  const composer = page.getByPlaceholder("Message nonclaw...");
  await expect(composer).toBeFocused();
  await composer.fill("review this change");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Skill: Code review")).toBeHidden();
  await expect
    .poll(() => {
      for (const rawFrame of sentFrames) {
        const frame = JSON.parse(rawFrame) as {
          method?: string;
          params?: {
            selected_skill_id?: string;
            prompt?: string;
            template?: string;
            instructions?: string;
            skill_name?: string;
            skill_description?: string;
          };
        };
        if (frame.method === "chat.send") {
          return {
            selectedSkillId: frame.params?.selected_skill_id,
            hasPrompt: "prompt" in (frame.params ?? {}),
            hasTemplate: "template" in (frame.params ?? {}),
            hasInstructions: "instructions" in (frame.params ?? {}),
            hasSkillName: "skill_name" in (frame.params ?? {}),
            hasSkillDescription: "skill_description" in (frame.params ?? {}),
          };
        }
      }
      return null;
    })
    .toEqual({
      selectedSkillId: "code_review",
      hasPrompt: false,
      hasTemplate: false,
      hasInstructions: false,
      hasSkillName: false,
      hasSkillDescription: false,
    });
});

test("inserts a built-in command without auto-sending", async ({ page }) => {
  let chatSendCount = 0;
  page.on("websocket", (socket) => {
    socket.on("framesent", (event) => {
      if (typeof event.payload !== "string") return;
      const frame = JSON.parse(event.payload) as { method?: string };
      if (frame.method === "chat.send") chatSendCount += 1;
    });
  });

  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible({ timeout: 30_000 });
  const composer = page.getByPlaceholder("Message nonclaw...");
  await composer.focus();
  await page.keyboard.press("/");
  const palette = page.getByRole("combobox");
  await expect(palette).toBeFocused();
  const paletteSurface = page.getByRole("listbox").locator("..");
  const backgroundAlpha = await paletteSurface.evaluate((element) => {
    const color = getComputedStyle(element).backgroundColor;
    if (color === "transparent") return 0;
    const rgba = color.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
    return rgba ? Number(rgba[1]) : 1;
  });
  expect(backgroundAlpha).toBe(1);
  await palette.fill("recall");
  await page.keyboard.press("Enter");

  await expect(composer).toHaveValue("!recall ");
  await expect(composer).toBeFocused();
  expect(chatSendCount).toBe(0);
});
