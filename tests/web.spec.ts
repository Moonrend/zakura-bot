import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const settingsKey = "zakura-bot.settings.v1";
const agent = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name}[.,]`) });
async function mockReady(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Mock channel · connected", { exact: true })).toBeVisible();
}
async function noOverflow(page: Page) {
  // useWindowDimensions responds on the next render after a viewport resize.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) }))).toEqual([]);
}

test("static hydration, search, unread and per-agent drafts", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockReady(page);
  await page.getByRole("textbox", { name: "Search agents" }).fill("no-such-agent");
  await expect(page.getByText("No matches for “no-such-agent”", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search agents", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Unread conversations, 1", exact: true }).click();
  await expect(agent(page, "Zakura")).toHaveCount(0);
  await agent(page, "Research").click();
  await expect(page.getByText("All caught up", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "All conversations, 3", exact: true }).click();
  await agent(page, "Zakura").click();
  await page.getByRole("textbox", { name: "Message Zakura", exact: true }).fill("Draft A");
  await agent(page, "Research").click();
  await expect(page.getByRole("textbox", { name: "Message Research", exact: true })).toHaveValue("");
  await page.getByRole("textbox", { name: "Message Research", exact: true }).fill("Draft B");
  await agent(page, "Zakura").click();
  await expect(page.getByRole("textbox", { name: "Message Zakura", exact: true })).toHaveValue("Draft A");
  await noOverflow(page);
  expect(errors).toEqual([]);
  await accessible(page);
});

test("IME Enter, multiline drafts, streaming, tool details and Stop", async ({ page }) => {
  await mockReady(page);
  const input = page.getByRole("textbox", { name: "Message Zakura", exact: true });
  await input.fill("你好");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, isComposing: true });
  await expect(input).toHaveValue("你好");
  await expect(page.getByTestId("chat-transcript").locator('[data-testid^="message-user_"]')).toHaveCount(0);
  await input.press("Shift+Enter");
  await input.pressSequentially("slow");
  await expect(input).toHaveValue("你好\nslow");
  await input.press("Enter");
  await input.press("Enter");
  await expect(page.getByTestId("chat-transcript").locator('[data-testid^="message-user_"]')).toHaveCount(1);
  await expect(page.getByText("Replying…", { exact: true })).toBeVisible();
  const tool = page.getByRole("button", { name: /^Tool chat_reply, Running/ });
  await tool.click();
  await expect(tool).toHaveAttribute("aria-expanded", "true");
  await input.fill("My next draft");
  await page.getByRole("button", { name: "Stop generating", exact: true }).click();
  await expect(page.getByText("Replying…", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Stopped", { exact: true }).first()).toBeVisible();
  await expect(input).toHaveValue("My next draft");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
});

test("tool failure can be dismissed and a conversation can recover", async ({ page }) => {
  await mockReady(page);
  const input = page.getByRole("textbox", { name: "Message Zakura", exact: true });
  await input.fill("fail");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Demo reply failed");
  await page.getByRole("button", { name: /^Tool chat_reply, Failed/ }).click();
  await expect(page.getByText("Reply could not be delivered (demo)", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss error", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await input.fill("hello");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toHaveCount(0, { timeout: 10_000 });
});

test("mobile drawer, Escape, offline drafts, touch layout and accessibility", async ({ page }) => {
  await mockReady(page);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open agent list", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Search agents", exact: true });
  await search.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Close agent list", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open agent list", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Open agent list", exact: true }).click();
  await accessible(page);
  await agent(page, "Ops").click();
  await expect(page.getByText("Ops is offline", { exact: true })).toBeVisible();
  const input = page.getByRole("textbox", { name: "Message Ops", exact: true });
  await input.fill("Saved while offline");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  await noOverflow(page);
  await accessible(page);
});

test("direct settings load, validation and persistence survive reload", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ key }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "https://saved.example.com", authToken: "saved-token", useMockChannel: true }));
  }, { key: settingsKey });
  await page.goto("/settings");
  const url = page.getByLabel("Zakura Base URL", { exact: true });
  await expect(url).toHaveValue("https://saved.example.com");
  await page.getByRole("switch", { name: "Use mock channel", exact: true }).click();
  await url.fill("https://example.com?token=bad");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("must not include");
  await url.fill("https://new.example.com/prefix");
  await page.getByLabel("Auth token", { exact: true }).fill("new-token");
  await page.getByRole("switch", { name: "Use mock channel", exact: true }).click();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByText("Settings saved on this device.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(url).toHaveValue("https://new.example.com/prefix");
  await expect(page.getByLabel("Auth token", { exact: true })).toHaveValue("new-token");
  await accessible(page);
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Message Zakura", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("storage failures do not show a false Saved result", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByLabel("Zakura Base URL", { exact: true })).toBeEditable();
  await page.getByLabel("Zakura Base URL", { exact: true }).fill("https://unsaved.example.com");
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("Storage quota exceeded"); }; });
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Storage quota exceeded");
  await expect(page.getByText("Settings saved on this device.", { exact: true })).toHaveCount(0);
});

test("live roster, rejected send retry, chat_reply cards and raw model event isolation", async ({ page }) => {
  const ids: string[] = [];
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [
        { id: "live", name: "Live agent", status: "idle", color: "#1084fe" },
      ] }));
      if (frame.type === "send") {
        ids.push(frame.clientMessageId);
        if (ids.length === 1) {
          socket.send(JSON.stringify({ type: "error", agentId: "live", clientMessageId: frame.clientMessageId, message: "Server rejected this message" }));
          return;
        }
        socket.send(JSON.stringify({ type: "message", message: { id: "server-user", clientMessageId: frame.clientMessageId,
          agentId: "live", role: "user", kind: "text", text: frame.text, createdAt: Date.now() } }));
        socket.send(JSON.stringify({ type: "assistant_message", text: "PRIVATE MODEL EVENT" }));
        socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "reply", createdAt: Date.now(), payload: {
          text: "Visible channel reply", reply_to: "server-user", attachments: [{ url: "https://example.com/report.pdf", name: "Report.pdf", type: "file" }],
          card: { title: "Status card", fields: [{ label: "Result", value: "Ready" }],
            table: { headers: ["Task", "Status"], rows: [["Build", "Passed"]] } },
          actions: [{ label: "Documentation", url: "https://example.com/docs" }],
        } }));
        socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "raw", createdAt: Date.now(), payload: { text: "**literal text**", format: "raw" } }));
        socket.send(JSON.stringify({ type: "typing", agentId: "live", active: false }));
      }
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Message Live agent", exact: true })).toBeVisible();
  await expect(agent(page, "Zakura")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Message Live agent", exact: true }).fill("Test delivery");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Server rejected this message");
  await page.getByRole("button", { name: "Retry failed message", exact: true }).click();
  await expect(page.getByText("Visible channel reply", { exact: true })).toBeVisible();
  await expect(page.getByTestId("message-reply")).toContainText("Reply to you");
  await expect(page.getByTestId("message-reply")).toContainText("Test delivery");
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  await expect(page.getByTestId(`message-${ids[0]}`)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Retry failed message", exact: true })).toHaveCount(0);
  await expect(page.getByText("PRIVATE MODEL EVENT", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("message-raw").getByText("**literal text**", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Report.pdf, opens in browser", exact: true })).toHaveAttribute("href", "https://example.com/report.pdf");
  await expect(page.getByRole("link", { name: "Documentation, opens in browser", exact: true })).toHaveAttribute("target", "_blank");
  await page.setViewportSize({ width: 320, height: 844 });
  await noOverflow(page);
  await accessible(page);
});

test("reading older messages is not interrupted by incoming replies", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "hello") return;
      socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      for (let index = 0; index < 30; index++) socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: `r${index}`,
        createdAt: index, payload: { text: `History message ${index}. ${"Long content. ".repeat(10)}` } }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const transcript = page.getByTestId("chat-transcript");
  await expect(page.getByTestId("message-r29")).toBeVisible();
  await transcript.hover();
  await page.mouse.wheel(0, -700);
  await expect(page.getByRole("button", { name: "Jump to latest", exact: true })).toBeVisible();
  const previous = await transcript.evaluate((element) => element.scrollTop);
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "new", createdAt: 50, payload: { text: "A new message arrived" } }));
  await expect(page.getByTestId("message-new")).toHaveCount(1);
  expect(await transcript.evaluate((element) => element.scrollTop)).toBe(previous);
  await page.getByRole("button", { name: "Jump to latest", exact: true }).click();
  await expect.poll(() => transcript.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(80);
});

test("composer shrinks after deletion and sending; Escape preserves drafts and releases focus", async ({ page }) => {
  await mockReady(page);
  const input = page.getByRole("textbox", { name: "Message Zakura", exact: true });
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await noOverflow(page);
    await input.fill(Array.from({ length: 10 }, (_, index) => `Draft line ${index}`).join("\n"));
    await expect.poll(() => input.evaluate((element) => element.clientHeight)).toBe(160);
    await input.fill("short draft");
    await expect.poll(() => input.evaluate((element) => element.clientHeight)).toBe(44);
    await input.press("Escape");
    await expect(input).not.toBeFocused();
    await expect(input).toHaveValue("short draft");
  }
  await input.fill("hello\n".repeat(8));
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect.poll(() => input.evaluate((element) => element.clientHeight)).toBe(44);
  await expect(page.getByText("Replying…", { exact: true })).toBeVisible();
  await expect(input).toBeFocused();
});

test("live roster refresh, stream replay, interrupt denial and offline recovery preserve the conversation", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  let userId = "";
  const roster = [{ id: "live", name: "Live", status: "idle" }];
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: roster }));
      if (frame.type === "send") {
        userId = frame.clientMessageId;
        socket.send(JSON.stringify({ type: "message", message: { id: "server-user", clientMessageId: userId,
          agentId: "live", role: "user", kind: "text", text: frame.text, createdAt: 1 } }));
        socket.send(JSON.stringify({ type: "typing", agentId: "live", active: true }));
        socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "stream", createdAt: 2, streaming: true, payload: {} }));
        socket.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "stream", delta: "First words" }));
      }
      if (frame.type === "interrupt") socket.send(JSON.stringify({ type: "error", agentId: "live", turnEnded: false, message: "Cannot interrupt this task" }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("Start task");
  await input.press("Enter");
  const reply = page.getByTestId("message-stream");
  await expect(reply).toContainText("First words");
  await input.fill("Next draft");
  channel!.send(JSON.stringify({ type: "agents", agents: roster }));
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "stream", createdAt: 2, streaming: true, payload: {} }));
  channel!.send(JSON.stringify({ type: "error", agentId: "live", clientMessageId: userId, message: "Stale rejection" }));
  await page.getByRole("button", { name: "Stop generating", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Cannot interrupt this task");
  channel!.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "stream", delta: " continue" }));
  await expect(reply).toContainText("First words continue");
  await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Retry failed message", exact: true })).toHaveCount(0);
  channel!.send(JSON.stringify({ type: "agents", agents: [{ ...roster[0], status: "offline" }] }));
  await expect(reply).toContainText("Stopped");
  await expect(input).toHaveValue("Next draft");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  channel!.send(JSON.stringify({ type: "agents", agents: roster }));
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  channel!.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "stream", delta: " discarded late token" }));
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "stream", createdAt: 2,
    payload: { text: "Recovered final reply", reply_to: "server-user" } }));
  await expect(reply).toContainText("Recovered final reply");
  await expect(reply).not.toContainText("Stopped");
  await expect(reply).toContainText("Reply to you");
  await expect(reply).toContainText("Start task");
});

test("long card content and an empty interrupted reply remain usable on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const longWord = "long".repeat(80);
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "hello") return;
      socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "card", createdAt: 1, payload: {
        card: { title: longWord, subtitle: longWord, fields: [{ label: longWord, value: longWord }],
          table: { headers: ["Column A", "Column B"], rows: [[longWord, longWord]] } },
        attachments: [{ name: `${longWord}.pdf`, url: "https://example.com/report.pdf" }],
        actions: [{ label: longWord, url: "https://example.com" }],
      } }));
      socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "empty", createdAt: 2, streaming: true, payload: {} }));
      socket.send(JSON.stringify({ type: "message_done", agentId: "live", messageId: "empty", interrupted: true }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  await expect(page.getByText("Reply stopped before any text arrived.", { exact: true })).toBeVisible();
  await noOverflow(page);
  const transcript = page.getByTestId("chat-transcript");
  expect(await transcript.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const table = page.getByRole("region", { name: "Card table", exact: true });
  await table.focus();
  await expect(table).toBeFocused();
  await table.press("ArrowRight");
  await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await accessible(page);
});
