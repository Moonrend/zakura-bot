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
  await expect(page.getByRole("button", { name: "Unread conversations, 0", exact: true })).toBeFocused();
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
  await page.setViewportSize({ width: 1100, height: 844 });
  await expect(page.getByRole("button", { name: "Close agent list", exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Open agent list", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close agent list", exact: true })).toHaveCount(0);
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

test("reading older messages ignores incoming replies, while sending returns to the latest", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "send") socket.send(JSON.stringify({ type: "message", message: {
        id: frame.clientMessageId, clientMessageId: frame.clientMessageId, agentId: "live", role: "user", kind: "text", text: frame.text, createdAt: 60,
      } }));
      if (frame.type !== "hello") return;
      socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      for (let index = 0; index < 30; index++) socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: `r${index}`,
        createdAt: index, payload: { text: `History message ${index}. ${"Long content. ".repeat(10)}` } }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const transcript = page.getByTestId("chat-transcript");
  await expect(page.getByTestId("message-r29")).toBeVisible();
  await transcript.focus();
  await expect(transcript).toBeFocused();
  await transcript.press("Home");
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(0);
  await transcript.press("End");
  await expect.poll(() => transcript.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(80);
  await transcript.hover();
  await page.mouse.wheel(0, -700);
  await expect(page.getByRole("button", { name: "Jump to latest", exact: true })).toBeVisible();
  const previous = await transcript.evaluate((element) => element.scrollTop);
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "new", createdAt: 50, payload: { text: "A new message arrived" } }));
  await expect(page.getByTestId("message-new")).toHaveCount(1);
  expect(await transcript.evaluate((element) => element.scrollTop)).toBe(previous);
  const jump = page.getByRole("button", { name: "Jump to latest", exact: true });
  await jump.focus();
  await jump.press("Enter");
  await expect(transcript).toBeFocused();
  await expect.poll(() => transcript.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(80);
  await transcript.hover();
  await page.mouse.wheel(0, -700);
  await expect(page.getByRole("button", { name: "Jump to latest", exact: true })).toBeVisible();
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("My next message");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect.poll(() => transcript.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(80);
  await expect(input).toBeFocused();
  await expect(page.getByRole("button", { name: "Jump to latest", exact: true })).toHaveCount(0);
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
  // Keep streaming observable while checking resize/focus after submission.
  await input.fill("slow\n".repeat(8));
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
  await expect(page.getByRole("button", { name: "Stopping reply", exact: true })).toBeDisabled();
  // The current v1 server's interrupt refusal does not include turnEnded.
  channel!.send(JSON.stringify({ type: "error", agentId: "live", message: "Cannot interrupt this task" }));
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

test("long headerless cards and an empty interrupted reply remain usable on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const longWord = "long".repeat(80);
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "hello") return;
      socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "card", createdAt: 1, payload: {
        card: { title: longWord, subtitle: longWord, fields: [{ label: longWord, value: longWord }],
          table: { headers: [], rows: [[longWord, longWord], ["A shorter row"]] } },
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

test("a reconnect retry with only a receipt clears pending delivery and preserves the next draft", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  const sends: { agentId: string; clientMessageId: string; text: string }[] = [];
  let connections = 0;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "hello") {
        connections += 1;
        socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      }
      if (frame.type === "send") {
        sends.push(frame);
        if (sends.length === 1) return; // Persisted by the server, but its receipt was lost.
        socket.send(JSON.stringify({ type: "message", message: { id: "server-user", clientMessageId: frame.clientMessageId,
          agentId: "live", role: "user", kind: "text", text: frame.text, createdAt: 1 } }));
      }
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("Check delivery");
  await input.press("Enter");
  await expect.poll(() => sends.length).toBe(1);
  await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toHaveAttribute("aria-busy", "true");
  await input.fill("Keep this next draft");
  await input.press("Enter");
  expect(sends).toHaveLength(1);
  channel!.close({ code: 1011, reason: "test disconnect before receipt" });
  await expect.poll(() => connections).toBe(2);
  await page.getByRole("button", { name: "Retry failed message", exact: true }).click();
  await expect.poll(() => sends.length).toBe(2);
  expect(sends[0].clientMessageId).toBe(sends[1].clientMessageId);
  await expect(page.getByTestId(`message-${sends[0].clientMessageId}`)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Retry failed message", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await expect(input).toHaveValue("Keep this next draft");
  const history = { type: "chat_reply", agentId: "live", messageId: "history", createdAt: 2, payload: { text: "Completed while disconnected", reply_to: "server-user" } };
  channel!.send(JSON.stringify(history));
  channel!.send(JSON.stringify(history));
  await expect(page.getByTestId("message-history")).toHaveCount(1);
  await expect(page.getByTestId("message-history")).toContainText("Reply to you");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toHaveCount(0);
});

test("older replay does not re-mark a read agent, while live stream updates do", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "hello") return;
      socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [
        { id: "live", name: "Live", status: "idle" }, { id: "other", name: "Other", status: "idle" },
      ] }));
      socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "latest", createdAt: 100, payload: { text: "Seen reply" } }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  await expect(page.getByTestId("message-latest")).toBeVisible();
  await agent(page, "Other").click();
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "backfill", createdAt: 50, payload: { text: "Older history" } }));
  await expect(agent(page, "Live")).not.toHaveAttribute("aria-label", /unread/);
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "stream", createdAt: 101, streaming: true, payload: {} }));
  channel!.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "stream", delta: "New live tokens" }));
  await expect(agent(page, "Live")).toHaveAttribute("aria-label", /unread/);
  await agent(page, "Live").click();
  await expect(page.getByTestId("message-backfill")).toBeVisible();
  await expect(page.getByTestId("message-stream")).toContainText("New live tokens");
});

test("unsupported file drops and image paste keep the page and draft intact", async ({ page }) => {
  await mockReady(page);
  const input = page.getByRole("textbox", { name: "Message Zakura", exact: true });
  await input.fill("Keep my draft");
  await expect(page.getByRole("button", { name: "Attachments are not available yet", exact: true })).toBeDisabled();
  const dropPrevented = await page.getByTestId("chat-transcript").evaluate((element) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(["test image"], "image.png", { type: "image/png" }));
    const event = new DragEvent("drop", { dataTransfer, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(dropPrevented).toBe(true);
  await expect(page.getByText("File uploads aren’t available yet. Paste text or a link instead.", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("Keep my draft");
  const pastePrevented = await input.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File(["test image"], "image.png", { type: "image/png" }));
    const event = new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(pastePrevented).toBe(true);
  await expect(input).toHaveValue("Keep my draft");
  expect(new URL(page.url()).pathname).toBe("/");
  await page.setViewportSize({ width: 320, height: 700 });
  await noOverflow(page);
  await accessible(page);
});

test("long channel errors keep the composer and keyboard-scrollable details reachable in short windows", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1,
        agents: [{ id: "live", name: "Live", status: "idle" }] }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("A long draft\n".repeat(12));
  channel!.send(JSON.stringify({ type: "error", agentId: "live", turnEnded: false, message: `Server detail: ${"retry detail ".repeat(120)}` }));
  const details = page.getByRole("region", { name: "Channel status details", exact: true });
  for (const height of [568, 320]) {
    await page.setViewportSize({ width: 320, height });
    await noOverflow(page);
    await expect.poll(() => input.evaluate((element) => element.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    const transcript = page.getByTestId("chat-transcript");
    await expect.poll(() => transcript.evaluate((element) => element.clientHeight)).toBeGreaterThan(0);
    await details.focus();
    await details.press("End");
    await expect.poll(() => details.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeInViewport();
  }
  await accessible(page);
});

test("a late stop refusal leaves the next live reply and its draft running", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1,
        agents: [{ id: "live", name: "Live", status: "busy" }] }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("Keep my next draft");
  await page.getByRole("button", { name: "Stop generating", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stopping reply", exact: true })).toBeDisabled();
  channel!.send(JSON.stringify({ type: "typing", agentId: "live", active: false }));
  channel!.send(JSON.stringify({ type: "typing", agentId: "live", active: true }));
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "next", createdAt: 1, streaming: true, payload: { text: "New reply" } }));
  channel!.send(JSON.stringify({ type: "error", agentId: "live", message: "Earlier Stop was refused" }));
  channel!.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "next", delta: " continues" }));
  await expect(page.getByRole("alert")).toContainText("Earlier Stop was refused");
  await expect(page.getByTestId("message-next")).toContainText("New reply continues");
  await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toBeEnabled();
  await expect(input).toHaveValue("Keep my next draft");
  channel!.send(JSON.stringify({ type: "typing", agentId: "live", active: false }));
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
});

test("mixed image and text paste keeps the caption and explains the skipped upload", async ({ page, context }) => {
  await mockReady(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const input = page.getByRole("textbox", { name: "Message Zakura", exact: true });
  await input.fill("My draft: ");
  await input.press("End");
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const png = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!), "image/png"));
    await navigator.clipboard.write([new ClipboardItem({
      "text/plain": new Blob(["Pasted caption"], { type: "text/plain" }), "image/png": png,
    })]);
  });
  await input.press("ControlOrMeta+V");
  await expect(input).toHaveValue("My draft: Pasted caption");
  await expect(page.getByText("File uploads aren’t available yet. Paste text or a link instead.", { exact: true })).toBeVisible();
  await input.pressSequentially(" edited");
  await expect(page.getByText("File uploads aren’t available yet. Paste text or a link instead.", { exact: true })).toHaveCount(0);
});

test("unsupported file drops are blocked on direct settings loads and empty rosters", async ({ page }) => {
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [] }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  for (const path of ["/settings", "/"]) {
    await page.goto(path);
    if (path === "/settings") await page.getByLabel("Zakura Base URL", { exact: true }).fill("https://unsaved.example.com");
    else await expect(page.getByText("No agents available", { exact: true })).toBeVisible();
    const prevented = await page.locator("body").evaluate((element) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(["draft"], "draft.txt", { type: "text/plain" }));
      return ["dragover", "drop"].map((type) => {
        const event = new DragEvent(type, { dataTransfer, bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      });
    });
    expect(prevented).toEqual([true, true]);
    expect(new URL(page.url()).pathname).toBe(path);
    if (path === "/settings") await expect(page.getByLabel("Zakura Base URL", { exact: true })).toHaveValue("https://unsaved.example.com");
  }
});

test("browser offline pauses delivery immediately and reconnect history restores the receipt without resending", async ({ page, context }) => {
  let channel: WebSocketRoute | undefined;
  let connections = 0;
  const sends: { clientMessageId: string; text: string }[] = [];
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "hello") {
        connections += 1;
        socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      }
      if (frame.type === "send") sends.push(frame);
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("Saved remotely before losing the receipt");
  await input.press("Enter");
  await expect.poll(() => sends.length).toBe(1);
  await input.fill("Keep my next draft");
  await context.setOffline(true);
  await expect(page.getByRole("alert")).toContainText("Network offline");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Retry failed message", exact: true })).toBeDisabled();
  await input.press("Enter");
  await expect(input).toHaveValue("Keep my next draft");
  expect(sends).toHaveLength(1);
  await context.setOffline(false);
  await expect.poll(() => connections).toBe(2);
  channel!.send(JSON.stringify({ type: "message", message: { id: "server-user", clientMessageId: sends[0].clientMessageId,
    agentId: "live", role: "user", kind: "text", text: sends[0].text, createdAt: 1 } }));
  await expect(page.getByRole("button", { name: "Retry failed message", exact: true })).toHaveCount(0);
  await expect(page.getByTestId(`message-${sends[0].clientMessageId}`)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await expect(input).toHaveValue("Keep my next draft");
  expect(sends).toHaveLength(1);
});

test("empty channel recovery remains keyboard accessible in a short narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 320 });
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [] }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const settings = page.getByRole("button", { name: "Open connection settings", exact: true });
  await expect(page.getByText("No agents available", { exact: true })).toBeVisible();
  await expect(settings).toBeVisible();
  channel!.send(JSON.stringify({ type: "error", fatal: true, message: "Binding unavailable. ".repeat(60) }));
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Binding unavailable");
  const setup = page.getByRole("region", { name: "Channel setup", exact: true });
  await setup.focus();
  await setup.press("End");
  await expect(settings).toBeInViewport({ ratio: 1 });
  const alertBounds = await alert.boundingBox();
  const setupBounds = await setup.boundingBox();
  expect(setupBounds!.y).toBeGreaterThanOrEqual(alertBounds!.y + alertBounds!.height);
  await noOverflow(page);
  await accessible(page);
  await settings.click();
  await expect(page.getByLabel("Auth token", { exact: true })).toHaveValue("test-channel-token");
});

test("an idle roster releases a Stop requested from a reconnect snapshot and keeps the draft", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1,
        agents: [{ id: "live", name: "Live", status: "busy" }] }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("Next message after reconnect");
  await page.getByRole("button", { name: "Stop generating", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stopping reply", exact: true })).toBeDisabled();
  channel!.send(JSON.stringify({ type: "agents", agents: [{ id: "live", name: "Live", status: "idle" }] }));
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await expect(input).toHaveValue("Next message after reconnect");
  await expect(agent(page, "Live")).toHaveAttribute("aria-label", /Available/);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("raw streaming replies retain a visible cursor and blank card decoration does not discard text", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "hello") return;
      socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "raw-stream", createdAt: 1, streaming: true,
        payload: { format: "raw", text: "**literal**" } }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const reply = page.getByTestId("message-raw-stream");
  await expect(reply).toContainText("**literal**");
  await expect(reply.getByText("▍", { exact: true })).toBeVisible();
  channel!.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "raw-stream", delta: " continues" }));
  channel!.send(JSON.stringify({ type: "message_done", agentId: "live", messageId: "raw-stream" }));
  await expect(reply).toContainText("**literal** continues");
  await expect(reply.getByText("▍", { exact: true })).toHaveCount(0);
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "decorated", createdAt: 2,
    payload: { text: "Visible despite blank card fields", kind: "card", card: { fields: [{ label: "", value: " " }] } } }));
  await expect(page.getByTestId("message-decorated")).toContainText("Visible despite blank card fields");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 700 });
  await noOverflow(page);
  await accessible(page);
});

test("a held composer action cannot send a draft or stop a turn after the button changes", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  const operations: string[] = [];
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      if (frame.type === "send" || frame.type === "interrupt") operations.push(frame.type);
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("Keep this next draft until I send it");

  for (const gesture of ["keyboard", "pointer"] as const) {
    channel!.send(JSON.stringify({ type: "typing", agentId: "live", active: true }));
    const stop = page.getByRole("button", { name: "Stop generating", exact: true });
    if (gesture === "keyboard") { await stop.focus(); await page.keyboard.down("Space"); }
    else { await stop.hover(); await page.mouse.down(); }
    channel!.send(JSON.stringify({ type: "typing", agentId: "live", active: false }));
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
    if (gesture === "keyboard") await page.keyboard.up("Space");
    else await page.mouse.up();
    await expect(input).toHaveValue("Keep this next draft until I send it");
    await expect(input).toBeFocused();
    expect(operations).toEqual([]);
  }

  await page.getByRole("button", { name: "Send message", exact: true }).focus();
  await page.keyboard.down("Space");
  channel!.send(JSON.stringify({ type: "typing", agentId: "live", active: true }));
  await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toBeEnabled();
  await page.keyboard.up("Space");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Keep this next draft until I send it");
  expect(operations).toEqual([]);
});

test("long search queries stay inside the narrow sidebar empty state", async ({ page }) => {
  await mockReady(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole("button", { name: "Open agent list", exact: true }).click();
  const query = "unmatched".repeat(100);
  await page.getByRole("textbox", { name: "Search agents", exact: true }).fill(query);
  const empty = page.getByText(`No matches for “${query}”`, { exact: true });
  await expect(empty).toBeVisible();
  await expect.poll(() => empty.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const bounds = await empty.boundingBox();
  expect(bounds!.width).toBeLessThan(272);
  expect(bounds!.height).toBeLessThan(80);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search agents", exact: true })).toBeFocused();
  await noOverflow(page);
});
