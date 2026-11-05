import { expect, test, type Page } from "@playwright/test";

const SESSION = {
  id: "e2e-skill-import-session",
  channel: "web",
  status: "active",
  started_at: 1,
  updated_at: 1,
};

const SAMPLE_PACKAGE_SUMMARY = {
  id: "qwen-image-local",
  name: "qwen-image-local",
  description: "Local image generation via Qwen with native local_image tool",
  version: "1.0.4-eigen-air.1",
  author: "Eigen Air Team",
  tags: ["image", "qwen"],
  source: "imported",
  format: "markdown",
  compatibility: "native",
  eligibility: "selectable",
  enabled: true,
  diagnostics: [],
  catalog_generation: 1,
  install_id: "00000000-0000-4000-8000-000000000001",
  content_revision: "rev-sha-12345678",
  local_state_revision: 1,
  required_tools: ["local_image"],
};

const SAMPLE_PACKAGE_DETAIL = {
  ...SAMPLE_PACKAGE_SUMMARY,
  system_prompt: "You are an expert image generation agent bound to local_image tool.",
  resources: [
    { path: "SKILL.md", size: 120, sha256: "sha-skill-md" },
    { path: "docs/REFERENCE.md", size: 250, sha256: "sha-ref-md" },
  ],
};

async function installSkillManagementFixtures(page: Page) {
  let skillsList = [SAMPLE_PACKAGE_SUMMARY];

  await page.addInitScript((sessionId) => {
    localStorage.setItem("eigen-air-daemon-url", "http://127.0.0.1:18791");
    localStorage.setItem("eigen-air-token", "test-owner-token");
    localStorage.setItem("eigen-air-session-id", sessionId);
    localStorage.removeItem("eigen-air-chat-messages");
  }, SESSION.id);

  await page.route("**/v1/skills**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (method === "GET") {
      if (url.pathname === "/v1/skills") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(skillsList),
        });
        return;
      }
      if (url.pathname === "/v1/skills/qwen-image-local") {
        const current = skillsList.find((s) => s.id === "qwen-image-local") || SAMPLE_PACKAGE_SUMMARY;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { etag: '"rev-sha-12345678"' },
          body: JSON.stringify({
            ...SAMPLE_PACKAGE_DETAIL,
            ...current,
          }),
        });
        return;
      }
      if (url.pathname === "/v1/skills/qwen-image-local/resources") {
        const pathParam = url.searchParams.get("path");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { etag: '"rev-sha-12345678"' },
          body: JSON.stringify({
            path: pathParam,
            content: "# Safe Reference Documentation\nAuthorized content.",
            size: 45,
            truncated: false,
          }),
        });
        return;
      }
    }

    if (method === "POST" && url.pathname === "/v1/skills/import") {
      const importedPkg = {
        ...SAMPLE_PACKAGE_SUMMARY,
        id: "new-uploaded-skill",
        name: "new-uploaded-skill",
        description: "Freshly imported package",
        enabled: false,
        eligibility: "disabled",
        local_state_revision: 1,
      };
      skillsList = [...skillsList, importedPkg];
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        headers: { etag: '"rev-sha-new-123"' },
        body: JSON.stringify(importedPkg),
      });
      return;
    }

    if (method === "PATCH" && url.pathname === "/v1/skills/qwen-image-local") {
      const postData = route.request().postDataJSON() as { enabled?: boolean } | null;
      const nextEnabled = postData?.enabled === true;
      skillsList = skillsList.map((s) =>
        s.id === "qwen-image-local"
          ? {
              ...s,
              enabled: nextEnabled,
              eligibility: nextEnabled ? "selectable" : "disabled",
              local_state_revision: (s.local_state_revision || 1) + 1,
            }
          : s
      );
      const updated = skillsList.find((s) => s.id === "qwen-image-local");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(updated),
      });
      return;
    }

    if (method === "DELETE" && url.pathname === "/v1/skills/qwen-image-local") {
      skillsList = skillsList.filter((s) => s.id !== "qwen-image-local");
      await route.fulfill({
        status: 204,
      });
      return;
    }

    await route.continue();
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
      } else if (request.method === "sessions.get") {
        const id = (request.params as { id?: string } | undefined)?.id;
        if (id === SESSION.id) {
          respond({ session: SESSION });
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
        respond({ sessions: [SESSION], next_cursor: null });
      } else if (request.method === "chat.history") {
        respond({ messages: [] });
      }
    });
  });
}

test("SkillBrowser renders shared library packages, allows inspection and resource preview", async ({
  page,
}) => {
  await installSkillManagementFixtures(page);
  await page.goto("/skills");

  // Verify list renders qwen-image-local with badges
  await expect(page.getByText("qwen-image-local")).toBeVisible();
  await expect(page.getByText("v1.0.4-eigen-air.1")).toBeVisible();

  // Click Inspect
  const inspectBtn = page.getByRole("button", { name: "Inspect" });
  await inspectBtn.click();

  // Verify sheet renders detail, manifest, system prompt, and resources
  await expect(page.getByText(/You are an expert image generation agent bound to local_image tool/)).toBeVisible();
  await expect(page.getByText("docs/REFERENCE.md (250 bytes)")).toBeVisible();

  // Click resource to preview
  await page.getByRole("button", { name: "Preview" }).last().click();
  await expect(page.getByText(/Authorized content/)).toBeVisible();
});

test("SkillBrowser allows toggling local consent switch and uninstalling package globally", async ({
  page,
}) => {
  await installSkillManagementFixtures(page);
  await page.goto("/skills");

  await expect(page.getByText("qwen-image-local")).toBeVisible();

  // Toggle local disable
  const toggle = page.getByRole("checkbox", {
    name: "Enable qwen-image-local for current runtime",
  });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();

  // Click Uninstall to open destructive modal
  const uninstallBtn = page.getByRole("button", { name: "Uninstall" });
  await uninstallBtn.click();

  // Modal safety explanations rendered
  await expect(page.getByText(/This removes the skill from the central shared skills library/)).toBeVisible();
  await expect(page.getByText(/All projects, daemons, and CLI sessions/)).toBeVisible();

  // Confirm uninstall
  const confirmBtn = page.getByRole("button", { name: "Uninstall globally" });
  await confirmBtn.click();

  // Verify package is removed from list
  await expect(page.getByText("No skills loaded")).toBeVisible();
});
