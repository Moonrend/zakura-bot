import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

test("groups retain names, order and bot membership after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try demo", exact: true }).click();
  await page.getByRole("button", { name: "Manage groups", exact: true }).click();
  for (const name of ["Work", "Personal"]) {
    await page.getByRole("textbox", { name: "New group name", exact: true }).fill(name);
    await page.getByRole("button", { name: "Create group", exact: true }).click();
    await expect(page.getByRole("button", { name: `Rename ${name}`, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Move Research to group", exact: true }).click();
  await page.getByRole("button", { name: "Place Research in Work", exact: true }).click();
  await page.getByRole("button", { name: "Rename Work", exact: true }).click();
  await page.getByRole("textbox", { name: "Rename group", exact: true }).fill("Projects");
  await page.getByRole("button", { name: "Save group name", exact: true }).click();
  await page.getByRole("button", { name: "Move Personal up", exact: true }).click();
  await page.getByRole("button", { name: "Close groups", exact: true }).click();
  const groups = page.locator('[data-testid^="sidebar-group-"]');
  await expect(groups.nth(0)).toContainText("Personal");
  await expect(groups.nth(1)).toContainText("Projects");
  await expect(groups.nth(1).getByRole("button", { name: /^Research[.,]/ })).toBeVisible();
  await page.reload();
  await expect(groups.nth(0)).toContainText("Personal");
  await expect(groups.nth(1)).toContainText("Projects");
  await expect(groups.nth(1).getByRole("button", { name: /^Research[.,]/ })).toBeVisible();
  await page.getByRole("button", { name: "Manage groups", exact: true }).click();
  await page.getByRole("button", { name: "Delete Projects", exact: true }).click();
  await page.getByRole("button", { name: "Close groups", exact: true }).click();
  await expect(groups.last()).toContainText("Ungrouped");
  await expect(groups.last().getByRole("button", { name: /^Research[.,]/ })).toBeVisible();
});

test("bot manager shows binding details and starts, stops and resets a server session", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("zakura-bot.settings.v1", JSON.stringify({
    zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-token", useMockChannel: false,
  })));
  const actions: string[] = [];
  await page.route("**/api/zakurabot/sessions/bot", (route) => {
    const action = route.request().method() === "POST" ? route.request().postDataJSON().action : "status";
    actions.push(action);
    return route.fulfill({ json: { session: { agentId: "bot", bindingId: "binding-123", sessionId: "session", status: action === "status" ? "not_started" : "ready" } } });
  });
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => socket.onMessage((raw) => {
    if (JSON.parse(String(raw)).type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [
      { id: "bot", name: "Research", title: "Briefs", description: "Your research assistant", bindingId: "binding-123", status: "idle" },
    ] }));
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Manage bots", exact: true }).click();
  await expect(page.getByText("Your research assistant", { exact: true })).toBeVisible();
  await expect(page.getByText("Binding: binding-123", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start session", exact: true }).click();
  await expect(page.getByText("Session: ready", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop session", exact: true }).click();
  await expect(page.getByText("The current run has stopped. You can send a message to continue.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await expect(page.getByText("New session ready. The bot starts with a fresh context.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open bot conversation", exact: true }).click();
  await expect(page.getByText("New session started. Your bot now has a fresh context.", { exact: true })).toBeVisible();
  expect(actions).toEqual(["status", "start", "stop", "new"]);
});

test("first launch authorizes in Zakura, persists only metadata locally, switches instances and signs out", async ({ page, context }) => {
  let identity = 0;
  const challenges = new Map<number, string>();
  const revoked: string[] = [];
  await context.route("**/console/zakurabot/authorize*", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Confirm the device code in Zakura</h1>" }));
  await page.route("**/api/zakurabot/oauth/*", async (route) => {
    const operation = route.request().url().split("/").pop();
    if (operation === "device-code") {
      identity += 1;
      const input = route.request().postDataJSON();
      expect(input.code_challenge_method).toBe("S256");
      expect(input.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
      challenges.set(identity, input.code_challenge);
      const origin = new URL(route.request().url()).origin;
      return route.fulfill({ json: { device_code: `device-${identity}`, user_code: "AB123-CD456", interval: 1, expires_in: 600,
        verification_uri: `${origin}/console/zakurabot/authorize`, verification_uri_complete: `${origin}/console/zakurabot/authorize?user_code=AB123-CD456` } });
    }
    if (operation === "revoke") { revoked.push(route.request().postDataJSON().token); return route.fulfill({ json: { ok: true } }); }
    expect(createHash("sha256").update(route.request().postDataJSON().code_verifier).digest("base64url")).toBe(challenges.get(identity));
    return route.fulfill({ json: { access_token: `access-${identity}`, refresh_token: `refresh-${identity}`, expires_in: 1800,
      refresh_expires_at: new Date(Date.now() + 86400000).toISOString(), device: { id: `device-${identity}`, name: "Browser", bindingIds: [`binding-${identity}`] },
      tenant: { id: `tenant-${identity}`, name: identity === 1 ? "Work" : "Personal" } } });
  });
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => socket.onMessage((raw) => {
    const frame = JSON.parse(String(raw));
    if (frame.type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1,
      agents: [{ id: frame.token, name: `Bot ${frame.token}`, status: "idle" }] }));
  }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Connect to Zakura" })).toBeVisible();
  await page.getByRole("textbox", { name: "Zakura instance URL", exact: true }).fill("http://127.0.0.1:4173");
  await page.getByRole("button", { name: "Sign in with Zakura", exact: true }).click();
  await expect(page.getByText("AB123-CD456", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Bot access-1", exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("access-1");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("refresh-1");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message Bot access-1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await page.getByRole("button", { name: "Add instance", exact: true }).click();
  await page.getByRole("textbox", { name: "Zakura instance URL", exact: true }).fill("http://localhost:4173");
  await page.getByRole("button", { name: "Sign in with Zakura", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message Bot access-2", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await page.getByRole("button", { name: "Switch to Work", exact: true }).click();
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message Bot access-1", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connect to Zakura" })).toBeVisible();
  expect(revoked).toEqual(["refresh-1"]);
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain("refresh-1");
  await expect(page.getByRole("button", { name: "Switch to Personal", exact: true })).toBeVisible();
});
