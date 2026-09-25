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

test("signed-in accounts create, edit and delete agents from the bot manager", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("zakura-bot.settings.v1", JSON.stringify({
    zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "oauth-token", useMockChannel: false,
  })));
  let socket: { send: (raw: string) => void } | undefined;
  const agents = [{ id: "scout", name: "Scout", bindingId: "auto-binding", status: "idle", description: "Scans the news" }];
  await page.route("**/api/me", (route) => route.fulfill({ json: { role: "owner", user: { name: "Ada" }, tenant: { name: "Work" } } }));
  await page.route("**/api/zakurabot/sessions/**", (route) => route.fulfill({ json: {
    session: { agentId: "scout", bindingId: "auto-binding", sessionId: null, status: "not_started" } } }));
  await page.route("**/api/agents", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toMatchObject({ name: "Scout", enableComputer: true });
      socket?.send(JSON.stringify({ type: "agents", agents }));
      return route.fulfill({ status: 201, json: { id: "scout", name: "Scout", slug: "scout", description: "Scans the news", enableComputer: true, enableMemory: false } });
    }
    return route.fulfill({ json: agents });
  });
  await page.route("**/api/agents/scout", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { id: "scout", name: "Scout", slug: "scout", description: "Scans the news", enableComputer: true, enableMemory: false } });
    }
    if (route.request().method() === "PATCH") {
      expect(route.request().postDataJSON()).toMatchObject({ name: "Scout Prime" });
      agents[0] = { ...agents[0]!, name: "Scout Prime" };
      socket?.send(JSON.stringify({ type: "agents", agents }));
      return route.fulfill({ json: { id: "scout", name: "Scout Prime", slug: "scout", description: "Scans the news", enableComputer: true, enableMemory: false } });
    }
    expect(route.request().method()).toBe("DELETE");
    agents.splice(0, agents.length);
    socket?.send(JSON.stringify({ type: "agents", agents }));
    return route.fulfill({ json: { ok: true } });
  });
  await page.routeWebSocket("**/api/zakurabot/ws", (ws) => {
    socket = ws;
    ws.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "hello") ws.send(JSON.stringify({ type: "ready", protocol: 1, agents: [] }));
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Manage bots", exact: true }).click();
  await expect(page.getByText("No agents yet. Create one below.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create agent", exact: true }).click();
  await page.getByRole("textbox", { name: "Agent name", exact: true }).fill("Scout");
  await page.getByRole("textbox", { name: "Agent description", exact: true }).fill("Scans the news");
  await page.getByRole("button", { name: "Toggle computer environment", exact: true }).click();
  await page.getByRole("button", { name: "Create agent", exact: true }).click();
  await expect(page.getByText("Scout is ready. Open its conversation to start talking.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manage Scout", exact: true }).click();
  await expect(page.getByText("Session: not started", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit agent", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Agent name", exact: true })).toHaveValue("Scout");
  await page.getByRole("textbox", { name: "Agent name", exact: true }).fill("Scout Prime");
  await page.getByRole("button", { name: "Save agent", exact: true }).click();
  await expect(page.getByText("Agent saved. The roster updates in a moment.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manage Scout Prime", exact: true }).click();
  await page.getByRole("button", { name: "Delete agent", exact: true }).click();
  await page.getByRole("button", { name: "Confirm delete agent", exact: true }).click();
  await expect(page.getByText("Agent deleted.", { exact: true })).toBeVisible();
});

test("first launch signs in through Zakura's OAuth, persists only metadata locally, switches instances and signs out", async ({ page, context }) => {
  let identity = 0;
  const verifiers: string[] = [];
  const revoked: string[] = [];
  await page.route("**/oauth/register", async (route) => {
    identity += 1;
    const input = route.request().postDataJSON();
    expect(input.token_endpoint_auth_method).toBe("none");
    expect(input.scope).toContain("api");
    expect(input.grant_types).toContain("authorization_code");
    return route.fulfill({ status: 201, json: { client_id: `client-${identity}` } });
  });
  await page.route("**/authorize**", async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("api");
    const state = url.searchParams.get("state") ?? "";
    const code = `oauth-code-${identity}`;
    const origin = url.origin;
    return route.fulfill({ contentType: "text/html", body: `<script>location.replace('/oauth/callback?code=${code}&state=${encodeURIComponent(state)}&iss=${encodeURIComponent(origin)}');</script>` });
  });
  await page.route("**/token", async (route) => {
    const input = route.request().postDataJSON() as Record<string, string>;
    if (route.request().url().includes("/token/revoke")) {
      revoked.push(input.token);
      return route.fulfill({ json: { revoked: true } });
    }
    expect(input.grant_type).toBe("authorization_code");
    expect(input.code).toMatch(/^oauth-code-\d$/);
    expect(input.code_verifier).toMatch(/^[0-9a-f]{64}$/);
    expect(input.client_id).toMatch(/^client-\d$/);
    verifiers.push(input.code_verifier);
    return route.fulfill({ json: { access_token: `access-${identity}`, refresh_token: `refresh-${identity}`, expires_in: 1800, scope: "api openid profile" } });
  });
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => socket.onMessage((raw) => {
    const frame = JSON.parse(String(raw));
    if (frame.type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1,
      agents: [{ id: frame.token, name: `Bot ${identity}`, status: "idle" }] }));
  }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Connect to Zakura" })).toBeVisible();
  await page.getByRole("textbox", { name: "Zakura instance URL", exact: true }).fill("http://127.0.0.1:4173");
  await page.getByRole("button", { name: "Sign in with Zakura", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /Message Bot/ })).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("access-1");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("refresh-1");
  await page.reload();
  await expect(page.getByRole("textbox", { name: /Message Bot/ })).toBeVisible();
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Connect to Zakura" })).toBeVisible();
  expect(revoked).toEqual(["refresh-1"]);
  expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain("refresh-1");
});
