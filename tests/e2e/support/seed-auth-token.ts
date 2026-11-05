import type { Page } from "@playwright/test";

export const SYNTHETIC_E2E_TOKEN = "e2e-synthetic-token";

export async function seedAuthToken(
  page: Page,
  token: string = SYNTHETIC_E2E_TOKEN
): Promise<void> {
  await page.addInitScript(
    ({ authToken }) => {
      const existing = localStorage.getItem("eigen-air-auth-token");
      if (!existing) {
        localStorage.setItem(
          "eigen-air-auth-token",
          JSON.stringify({
            token: authToken,
            retention: "forever",
            savedAt: Date.now(),
            expiresAt: null,
          })
        );
      }
    },
    { authToken: token }
  );
}
