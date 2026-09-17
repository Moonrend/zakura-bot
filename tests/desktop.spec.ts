import { expect, test, type Page } from "@playwright/test";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=", "base64");
async function desktopBot(page: Page, enabled = true) {
  await page.addInitScript(() => localStorage.setItem("zakura-bot.settings.v1", JSON.stringify({
    zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "desktop-token", useMockChannel: false,
  })));
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => socket.onMessage((raw) => {
    if (JSON.parse(String(raw)).type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [
      { id: "bot", name: "Research", status: "idle", capabilities: { files: true, desktop: enabled, interactions: true } },
    ] }));
  }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "View bot desktop", exact: true })).toBeVisible();
}

test("open the bot desktop, refresh a complete authenticated frame and return to the draft", async ({ page }) => {
  let captures = 0;
  await page.route("**/api/zakurabot/agents/bot/desktop", (route) => {
    expect(route.request().headers().authorization).toBe("Bearer desktop-token");
    return route.fulfill({ json: { enabled: true, supported: true, width: 1280, height: 720, suggestedIntervalMs: 2000,
      frameUrl: "https://untrusted.example/do-not-use" } });
  });
  await page.route("**/api/zakurabot/agents/bot/desktop/frame", (route) => {
    captures += 1;
    expect(route.request().headers().authorization).toBe("Bearer desktop-token");
    expect(route.request().url()).not.toContain("token");
    return route.fulfill({ contentType: "image/png", body: png, headers: { "X-Frame-Captured-At": "2026-09-17T12:00:00Z" } });
  });
  await desktopBot(page);
  await page.getByRole("textbox", { name: "Message Research", exact: true }).fill("Continue after looking at the desktop");
  await page.getByRole("button", { name: "View bot desktop", exact: true }).click();
  await expect(page.getByTestId("desktop-frame")).toBeVisible();
  await expect(page.getByText(/Captured .*1280 × 720/)).toBeVisible();
  expect(captures).toBe(1);
  await page.getByRole("button", { name: "Refresh desktop", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh desktop", exact: true })).toBeEnabled();
  expect(captures).toBe(2);
  await page.clock.install();
  await page.getByRole("button", { name: "Enable desktop updates", exact: true }).click();
  await page.clock.fastForward(2100);
  await expect.poll(() => captures).toBeGreaterThan(2);
  await page.getByRole("button", { name: "Close desktop", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message Research", exact: true })).toHaveValue("Continue after looking at the desktop");
  const stoppedAt = captures;
  await page.clock.fastForward(10_000);
  expect(captures).toBe(stoppedAt);
});

test("failed refresh keeps the last capture and recovers on retry", async ({ page }) => {
  let captures = 0;
  await page.route("**/api/zakurabot/agents/bot/desktop", (route) => route.fulfill({ json: { enabled: true, supported: true } }));
  await page.route("**/api/zakurabot/agents/bot/desktop/frame", (route) => {
    captures += 1;
    return captures === 2 ? route.fulfill({ status: 503, json: { error: "Computer is starting" } }) : route.fulfill({ contentType: "image/png", body: png });
  });
  await desktopBot(page);
  await page.getByRole("button", { name: "View bot desktop", exact: true }).click();
  await expect(page.getByTestId("desktop-frame")).toBeVisible();
  await page.getByRole("button", { name: "Refresh desktop", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Computer is starting");
  await expect(page.getByTestId("desktop-frame")).toBeVisible();
  await page.getByRole("button", { name: "Refresh desktop", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh desktop", exact: true })).toBeEnabled();
  expect(captures).toBe(3);
});

test("bots without desktop access explain how to enable it", async ({ page }) => {
  await desktopBot(page, false);
  await page.getByRole("button", { name: "View bot desktop", exact: true }).click();
  await expect(page.getByText("Enable Computer for this bot in Zakura, then reconnect to view its desktop.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh desktop", exact: true })).toBeDisabled();
  await expect(page.getByTestId("desktop-frame")).toHaveCount(0);
});
