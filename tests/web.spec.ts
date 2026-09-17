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

for (const width of [1440, 320]) test(`selecting reply text pauses following until reading resumes (${width}px)`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "hello") return;
      socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      for (let index = 0; index < 15; index++) socket.send(JSON.stringify({ type: "chat_reply", agentId: "live",
        messageId: `history-${index}`, createdAt: index,
        payload: { text: `Select this reply ${index}. ${"Readable history. ".repeat(15)}` } }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({
    zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false,
  })), { key: settingsKey });
  await page.goto("/");
  const transcript = page.getByTestId("chat-transcript");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  const jump = page.getByRole("button", { name: "Jump to latest", exact: true });
  await expect(page.getByTestId("message-history-14")).toBeVisible();
  await expect.poll(() => transcript.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
  await transcript.focus();
  const selected = await page.getByTestId("message-history-14").getByTestId("message-text").evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    return selection.toString();
  });
  const before = await transcript.evaluate((element) => element.scrollTop);
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "incoming", createdAt: 15,
    streaming: true, payload: { text: "Small update" } }));
  await expect(page.getByTestId("message-incoming")).toContainText("Small update");
  const settledTop = () => transcript.evaluate(async (element) => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return element.scrollTop;
  });
  expect(await settledTop()).toBe(before);
  await expect(jump).toBeVisible();
  channel!.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "incoming",
    delta: `\n${"More arriving output.\n".repeat(40)}End of incoming output.` }));
  await expect(page.getByTestId("message-incoming")).toContainText("End of incoming output.");
  expect(await settledTop()).toBe(before);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);

  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  channel!.send(JSON.stringify({ type: "message_done", agentId: "live", messageId: "incoming" }));
  expect(await settledTop()).toBe(before);
  await jump.click();
  await expect.poll(() => transcript.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
  await input.fill("Keep editing this next draft");
  await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(5, 12));
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "next", createdAt: 16,
    payload: { text: "Follow this reply while editing the draft." } }));
  await expect(page.getByTestId("message-next")).toBeVisible();
  await expect.poll(() => transcript.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
  await expect(jump).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Keep editing this next draft");
  expect(await input.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([5, 12]);
});

test("disabling focused conversation controls preserves navigation and the next draft", async ({ page, context }) => {
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1,
        agents: [{ id: "live", name: "Live", status: "idle" }] }));
      if (frame.type === "send") socket.send(JSON.stringify({ type: "error", agentId: "live",
        clientMessageId: frame.clientMessageId, message: "Delivery rejected; try again later" }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({
    zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false,
  })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  const transcript = page.getByTestId("chat-transcript");
  const send = page.getByRole("button", { name: "Send message", exact: true });
  const suggestion = page.getByRole("button", { name: "Say hello", exact: true });
  await input.fill("Keep this draft while offline");
  await suggestion.focus();
  await context.setOffline(true);
  await expect(suggestion).toBeDisabled();
  await expect(transcript).toBeFocused();
  await expect(input).toHaveValue("Keep this draft while offline");
  await context.setOffline(false);
  await expect(send).toBeEnabled();

  await send.focus();
  channel!.send(JSON.stringify({ type: "agents", agents: [{ id: "live", name: "Live", status: "offline" }] }));
  await expect(send).toBeDisabled();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Keep this draft while offline");
  channel!.send(JSON.stringify({ type: "agents", agents: [{ id: "live", name: "Live", status: "idle" }] }));
  await expect(send).toBeEnabled();
  await expect(input).toBeFocused();
  await input.press("Enter");
  const retry = page.getByRole("button", { name: "Retry failed message", exact: true });
  await expect(retry).toBeEnabled();
  await input.fill("Keep the next draft during the reply");
  await retry.focus();
  channel!.send(JSON.stringify({ type: "typing", agentId: "live", active: true }));
  await expect(retry).toBeDisabled();
  await expect(transcript).toBeFocused();

  // Availability changes in the background must not take the draft's focus.
  await input.focus();
  channel!.send(JSON.stringify({ type: "typing", agentId: "live", active: false }));
  await expect(retry).toBeEnabled();
  await expect(input).toBeFocused();
  await context.setOffline(true);
  await expect(retry).toBeDisabled();
  await expect(input).toBeFocused();
  await context.setOffline(false);
  await expect(retry).toBeEnabled();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Keep the next draft during the reply");
  await accessible(page);
});

test("tool updates that remove details preserve transcript navigation and leave focused drafts alone", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1,
        agents: [{ id: "live", name: "Live", status: "idle" }] }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({
    zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false,
  })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  const transcript = page.getByTestId("chat-transcript");
  await input.fill("Keep the next draft");
  const updateTool = (id: string, detail?: string, ok?: boolean) => channel!.send(JSON.stringify({
    type: "tool_activity", agentId: "live", message: { id, agentId: "live", role: "assistant", kind: "activity",
      createdAt: 1, tool: { name: "search", detail, ok } },
  }));
  for (const [index, detail] of [undefined, "", " \n\t "].entries()) {
    const id = `tool-${index}`;
    updateTool(id, "Read these details");
    const row = page.getByTestId(`transcript-row-${id}`);
    const chip = row.getByRole("button", { name: "Tool search, Running", exact: true });
    await chip.press("Enter");
    await expect(chip).toHaveAttribute("aria-expanded", "true");
    await expect(row.getByText("Read these details", { exact: true })).toBeVisible();
    updateTool(id, detail, true);
    await expect(row.getByRole("button")).toHaveCount(0);
    await expect(row.getByTestId("message-text")).toHaveCount(0);
    await expect(transcript).toBeFocused();
    await expect(input).toHaveValue("Keep the next draft");
  }

  updateTool("background", "Keep useful indentation\n  in tool output");
  const row = page.getByTestId("transcript-row-background");
  await row.getByRole("button", { name: "Tool search, Running", exact: true }).click();
  await expect(row.getByTestId("message-text")).toHaveText("Keep useful indentation\n  in tool output", { useInnerText: true });
  await input.focus();
  updateTool("background", undefined, true);
  await expect(row.getByRole("button")).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Keep the next draft");
  await accessible(page);
});

test("successful reconnect removes stale channel warnings while failed sends remain retryable", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  let connections = 0;
  const sends: { clientMessageId: string; text: string }[] = [];
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    connections += 1;
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1,
        agents: [{ id: "live", name: "Live", status: "idle" }, { id: "research", name: "Research", status: "idle" }] }));
      if (frame.type === "send") {
        sends.push(frame);
        socket.send(JSON.stringify(sends.length === 1
          ? { type: "error", agentId: "live", clientMessageId: frame.clientMessageId, message: "Delivery rejected; retry this message" }
          : { type: "message", message: { id: frame.clientMessageId, clientMessageId: frame.clientMessageId,
            agentId: "live", role: "user", kind: "text", text: frame.text, createdAt: 1 } }));
      }
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({
    zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false,
  })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("Retry this request");
  await input.press("Enter");
  const retry = page.getByRole("button", { name: "Retry failed message", exact: true });
  await expect(retry).toBeEnabled();
  await input.fill("Keep the next draft");
  channel!.send(JSON.stringify({ type: "error", agentId: "research", turnEnded: true, message: "Research run failed" }));
  const unavailable = "Zakura Bot is temporarily unavailable";
  channel!.send(JSON.stringify({ type: "error", message: unavailable, fatal: false }));
  await expect(page.getByText(unavailable, { exact: true })).toBeVisible();
  channel!.close({ code: 1011, reason: "temporary service failure" });
  await expect.poll(() => connections).toBe(2);
  await expect(page.getByText("Live WS channel · connected", { exact: true })).toBeVisible();
  await expect(page.getByText(unavailable, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Delivery rejected; retry this message", { exact: true })).toBeVisible();
  await expect(retry).toBeEnabled();
  await expect(input).toHaveValue("Keep the next draft");
  await expect(input).toBeFocused();
  expect(sends).toHaveLength(1);

  await retry.click();
  await expect(retry).toHaveCount(0);
  expect(sends).toHaveLength(2);
  expect(sends[1]).toEqual(sends[0]);
  await expect(page.getByRole("region", { name: "Channel status details", exact: true })).toHaveCount(0);
  await expect(input).toHaveValue("Keep the next draft");
  await agent(page, "Research").click();
  await expect(page.getByText("Research run failed", { exact: true })).toBeVisible();
});

test("mobile keyboard resizing keeps the composer inside the visible viewport and restores its draft layout", async ({ page }) => {
  await mockReady(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Open agent list", exact: true })).toBeVisible();
  const input = page.getByRole("textbox", { name: "Message Zakura", exact: true });
  const draft = "Keep this multiline draft while the keyboard opens.\n".repeat(6);
  await input.fill(draft);
  const send = page.getByRole("button", { name: "Send message", exact: true });
  const transcript = page.getByTestId("chat-transcript");
  const originalInputHeight = await input.evaluate((element) => element.clientHeight);

  for (const height of [480, 320, 844]) {
    // Mobile keyboards can resize only visualViewport; the layout viewport
    // and its percentage-height containers keep their original height.
    await page.evaluate((height) => {
      Object.defineProperty(window.visualViewport, "height", { configurable: true, value: height });
      window.visualViewport!.dispatchEvent(new Event("resize"));
    }, height);
    expect(await page.evaluate(() => innerHeight)).toBe(844);
    await expect.poll(() => send.evaluate((element) => element.getBoundingClientRect().bottom <= window.visualViewport!.height)).toBe(true);
    await expect.poll(() => input.evaluate((element) => element.getBoundingClientRect().top >= 0)).toBe(true);
    await expect.poll(() => transcript.evaluate((element) => element.clientHeight)).toBeGreaterThan(0);
    await expect(input).toHaveValue(draft);
    await expect(input).toBeFocused();
    await expect(send).toBeEnabled();
  }
  await expect.poll(() => input.evaluate((element) => element.clientHeight)).toBe(originalInputHeight);
  await expect.poll(() => send.evaluate((element) => element.getBoundingClientRect().bottom)).toBeGreaterThan(780);
  await noOverflow(page);
});

test("the mobile agent drawer fits above the keyboard and lets search scroll away in a short viewport", async ({ page }) => {
  await mockReady(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const input = page.getByRole("textbox", { name: "Message Zakura", exact: true });
  await input.fill("Keep the conversation draft while searching");
  await page.getByRole("button", { name: "Open agent list", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Search agents", exact: true });
  await search.fill("r");
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", { configurable: true, value: 320 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  const settings = page.getByRole("button", { name: "Open settings", exact: true });
  await expect.poll(() => settings.evaluate((element) => element.getBoundingClientRect().bottom <= window.visualViewport!.height)).toBe(true);
  await expect(search).toBeFocused();
  const list = page.getByRole("region", { name: "Agent list", exact: true });
  await agent(page, "Ops").focus();
  const listTop = await list.evaluate((element) => element.getBoundingClientRect().top);
  await expect.poll(() => search.evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(listTop);
  const lastRow = await agent(page, "Ops").boundingBox();
  const listBottom = await list.evaluate((element) => element.getBoundingClientRect().bottom);
  expect(lastRow!.y).toBeGreaterThanOrEqual(listTop);
  expect(lastRow!.y + lastRow!.height).toBeLessThanOrEqual(listBottom);
  await expect(search).toHaveValue("r");

  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", { configurable: true, value: 844 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect.poll(() => settings.evaluate((element) => element.getBoundingClientRect().bottom)).toBeGreaterThan(780);
  await page.getByRole("button", { name: "Close agent list", exact: true }).click();
  await expect(input).toHaveValue("Keep the conversation draft while searching");
  await noOverflow(page);
});

test("quotes resolve late history in their own conversation and summarize card, file and action replies", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1,
        agents: [{ id: "live", name: "Live", status: "idle" }, { id: "other", name: "Other", status: "idle" }] }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("Keep the next draft");
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "other", messageId: "reference", createdAt: 1,
    payload: { text: "A different conversation's result" } }));
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "followup", createdAt: 2,
    payload: { text: "About the previous result", reply_to: "reference" } }));
  const quote = page.getByTestId("message-followup");
  await expect(quote).toContainText("Reply to earlier message");
  await expect(quote).not.toContainText("A different conversation's result");

  const cases = [
    { payload: { card: { title: " \n ", text: "Read the card body", subtitle: "Card subtitle" } }, summary: "Read the card body" },
    { payload: { card: { subtitle: "A card with only a subtitle" } }, summary: "A card with only a subtitle" },
    { payload: { attachments: [{ url: "https://example.com/report%20final.pdf?signature=a%2Bb", name: " \t " }] }, summary: "report final.pdf" },
    { payload: { attachments: [{ url: "https://example.com/%20%20", name: "" }] }, summary: "Attachment" },
    { payload: { actions: [{ url: "https://example.com/report", label: "Review the report" }] }, summary: "Review the report" },
    { payload: { card: { links: [{ url: "https://example.com/details", label: "Open the card details" }] } }, summary: "Open the card details" },
    { payload: { card: { fields: [{ label: "Status", value: "Ready" }] } }, summary: "Card" },
  ];
  for (const { payload, summary } of cases) {
    channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "reference", createdAt: 1, payload }));
    await expect(quote).toContainText("Reply to agent");
    await expect(quote.getByText(summary, { exact: true })).toBeVisible();
    await expect(quote).not.toContainText("Earlier message");
    await expect(quote.getByRole("link")).toHaveCount(0);
    await expect(input).toHaveValue("Keep the next draft");
  }
  await noOverflow(page);
  await accessible(page);
});

test("a Stop click racing a terminal frame cannot restart the waiting state or discard the next draft", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  let interrupts = 0;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1,
        agents: [{ id: "live", name: "Live", status: "busy" }] }));
      if (frame.type === "interrupt") interrupts++;
    });
  });
  await page.addInitScript(({ key }) => {
    localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false }));
    const target = window as Window & { zakuraTestSocket?: WebSocket };
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        target.zakuraTestSocket = this;
      }
    };
  }, { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("Keep the next draft after the turn ends");
  const stop = page.getByRole("button", { name: "Stop generating", exact: true });
  const send = page.getByRole("button", { name: "Send message", exact: true });
  for (const terminal of [
    { type: "typing", agentId: "live", active: false },
    { type: "agents", agents: [{ id: "live", name: "Live", status: "idle" }] },
    { type: "error", agentId: "live", turnEnded: true, message: "The run ended with an error" },
  ]) {
    channel!.send(JSON.stringify({ type: "agents", agents: [{ id: "live", name: "Live", status: "busy" }] }));
    await stop.focus();
    const clickedWhileMounted = await page.evaluate((frame) => {
      const socket = (window as Window & { zakuraTestSocket?: WebSocket }).zakuraTestSocket!;
      const control = document.querySelector<HTMLElement>('[aria-label="Stop generating"]')!;
      // Deliver the terminal event and click in one task, before React can
      // replace the old control with Send. The transport has already heard it.
      socket.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }));
      const mounted = control.isConnected;
      control.click();
      return mounted;
    }, terminal);
    expect(clickedWhileMounted).toBe(true);
    await expect(send).toBeEnabled();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("Keep the next draft after the turn ends");
    expect(interrupts).toBe(0);
  }
  channel!.send(JSON.stringify({ type: "typing", agentId: "live", active: true }));
  await stop.click();
  await expect.poll(() => interrupts).toBe(1);
  await expect(page.getByRole("button", { name: "Stopping reply", exact: true })).toBeVisible();
  channel!.send(JSON.stringify({ type: "typing", agentId: "live", active: false }));
  await expect(send).toBeEnabled();
  await expect(input).toHaveValue("Keep the next draft after the turn ends");
});

test("reply updates preserve the focused link through reordering and restore transcript focus when its destination disappears", async ({ page }) => {
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
  await input.fill("Keep my draft through reply updates");
  const transcript = page.getByTestId("chat-transcript");
  const update = (payload: object) => channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live",
    messageId: "report", createdAt: 1, payload }));

  for (const kind of ["actions", "attachments", "images", "links"] as const) {
    const payload = (names: string[]) => {
      const links = names.map((name) => ({ url: `https://example.com/${name}`, label: name, name, alt: name }));
      return { text: "Updated report", ...(kind === "images" || kind === "links" ? { card: { [kind]: links } } : { [kind]: links }) };
    };
    update(payload(["First", "Second"]));
    const second = page.getByRole("link", { name: "Second, opens in browser", exact: true });
    await second.focus();
    update(payload(["Second", "First", "Third"]));
    await expect(page.getByRole("link", { name: "Third, opens in browser", exact: true })).toHaveCount(1);
    await expect(second).toBeFocused();
    update(payload(["First", "Third"]));
    await expect(second).toHaveCount(0);
    await expect(transcript).toBeFocused();
    await expect(input).toHaveValue("Keep my draft through reply updates");

    // An unrelated update must never pull focus away from the next draft.
    await input.focus();
    update(payload(["Third"]));
    await expect(page.getByRole("link", { name: "First, opens in browser", exact: true })).toHaveCount(0);
    await expect(input).toBeFocused();
  }

  update({ text: "Report", actions: [{ label: "Download", url: "https://example.com/original" }] });
  const download = page.getByRole("link", { name: "Download, opens in browser", exact: true });
  await download.focus();
  update({ text: "Report", actions: [{ label: "Download", url: "https://example.com/replacement" }] });
  await expect(download).toHaveAttribute("href", "https://example.com/replacement");
  await expect(transcript).toBeFocused();

  update({ text: "Read [the report](https://example.com/original)." });
  await page.getByRole("link", { name: "the report, opens in browser", exact: true }).focus();
  update({ text: "Read [the report](https://example.com/replacement)." });
  await expect(page.getByRole("link", { name: "the report, opens in browser", exact: true })).toHaveAttribute("href", "https://example.com/replacement");
  await expect(transcript).toBeFocused();
  await expect(input).toHaveValue("Keep my draft through reply updates");
  await transcript.press("Home");
  await expect(page.getByRole("button", { name: "Jump to latest", exact: true })).toHaveCount(0);
  await accessible(page);
});

test("removing a focused reply table restores transcript navigation and preserves the next draft", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
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
  await input.fill("Keep the next draft");
  const transcript = page.getByTestId("chat-transcript");
  const table = page.getByRole("region", { name: "Card table", exact: true });
  const update = (card?: object) => channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live",
    messageId: "report", createdAt: 1, payload: { text: "Report", card } }));
  const report = { title: "Results", table: { headers: ["Task", "Status", "Notes"], rows: [["Review", "Done", "Ready"]] } };
  for (const replacement of [{ title: "Updated results" }, undefined]) {
    update(report);
    await table.focus();
    await table.press("ArrowRight");
    await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    update(replacement);
    await expect(table).toHaveCount(0);
    await expect(transcript).toBeFocused();
    await expect(input).toHaveValue("Keep the next draft");
  }
  update(report);
  await expect(table).toHaveCount(1);
  await input.focus();
  update();
  await expect(table).toHaveCount(0);
  await expect(input).toBeFocused();
  await noOverflow(page);
  await accessible(page);
});

for (const width of [1440, 320]) test(`earlier history loads in pages without losing quotes, reading position or keyboard focus (${width}px)`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "hello") return;
      socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      for (let index = 0; index < 125; index++) {
        socket.send(JSON.stringify(index === 10 ? { type: "message", message: {
          id: "history-10", clientMessageId: "history-10", agentId: "live", role: "user", kind: "text", text: "The original request outside this page", createdAt: 1000 + index,
        } } : { type: "chat_reply", agentId: "live", messageId: `history-${index}`, createdAt: 1000 + index,
          payload: { text: `History ${index}. ${"Previous content. ".repeat(8)}`, reply_to: index === 124 ? "history-10" : undefined } }));
      }
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const transcript = page.getByTestId("chat-transcript");
  const rows = transcript.locator('[data-testid^="transcript-row-"]');
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await expect(rows).toHaveCount(50);
  await expect(page.getByTestId("message-history-124")).toBeInViewport();
  await expect(page.getByTestId("message-history-10")).toHaveCount(0);
  await expect(page.getByTestId("message-history-124")).toContainText("Reply to you");
  await expect(page.getByTestId("message-history-124")).toContainText("The original request outside this page");
  await input.fill("Keep the draft while loading history");
  // On narrow screens this draft grows the composer. Home must take priority
  // over any follow scroll still queued by that resize.
  await transcript.focus();
  await transcript.press("Home");
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(0);
  const load = page.getByRole("button", { name: "Load earlier messages", exact: true });
  await load.focus();
  const anchor = page.getByTestId("transcript-row-history-75");
  const top = await anchor.evaluate((element) => element.getBoundingClientRect().top);
  await load.press("Enter");
  await expect(rows).toHaveCount(100);
  await expect(page.getByTestId("message-history-25")).toHaveCount(1);
  await expect.poll(() => anchor.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(top, 0);
  await expect(transcript).toBeFocused();
  await expect(page.getByText("50 earlier messages loaded. 25 more available.", { exact: true })).toHaveCount(1);

  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "new", createdAt: 2000, payload: { text: "A live reply after loading history" } }));
  await expect(rows).toHaveCount(101);
  await expect.poll(() => anchor.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(top, 0);
  await expect(transcript).toBeFocused();
  await expect(input).toHaveValue("Keep the draft while loading history");

  await transcript.press("Home");
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(0);
  await load.focus();
  const lastAnchor = page.getByTestId("transcript-row-history-25");
  const lastTop = await lastAnchor.evaluate((element) => element.getBoundingClientRect().top);
  await load.press("Enter");
  await expect(rows).toHaveCount(126);
  await expect(load).toHaveCount(0);
  await expect(page.getByTestId("message-history-0")).toHaveCount(1);
  await expect(page.getByTestId("message-history-10")).toHaveCount(1);
  await expect.poll(() => lastAnchor.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(lastTop, 0);
  await expect(transcript).toBeFocused();
  await expect(page.getByText("25 earlier messages loaded. All available history is shown.", { exact: true })).toHaveCount(1);
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "older-backfill", createdAt: 0,
    payload: { text: "Additional available history" } }));
  await expect(load).toHaveCount(1);
  await expect(rows).toHaveCount(126);
  await expect(page.getByText("25 earlier messages loaded. 1 more available.", { exact: true })).toHaveCount(1);
  await expect.poll(() => lastAnchor.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(lastTop, 0);
  await noOverflow(page);
  await accessible(page);
});

test("reading a paged transcript retains its rows through live appends and backfill; switching agents resets the page", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "hello") return;
      socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }, { id: "other", name: "Other", status: "idle" }] }));
      for (const agentId of ["live", "other"]) for (let index = 0; index < 75; index++) socket.send(JSON.stringify({
        type: "chat_reply", agentId, messageId: `history-${index}`, createdAt: 1000 + index, payload: { text: `${agentId} history ${index}. ${"Previous content. ".repeat(8)}` },
      }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const transcript = page.getByTestId("chat-transcript");
  const rows = transcript.locator('[data-testid^="transcript-row-"]');
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await expect(rows).toHaveCount(50);
  await expect(page.getByTestId("message-history-74")).toBeInViewport();
  for (let index = 75; index < 80; index++) channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: `history-${index}`,
    createdAt: 1000 + index, payload: { text: `live history ${index}` } }));
  await expect(page.getByTestId("message-history-79")).toBeInViewport();
  await expect(rows).toHaveCount(50);
  await expect(page.getByTestId("message-history-25")).toHaveCount(0);
  await transcript.focus();
  await transcript.press("Home");
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(0);
  await expect(page.getByRole("button", { name: "Jump to latest", exact: true })).toBeVisible();
  const anchor = page.getByTestId("transcript-row-history-30");
  const top = await anchor.evaluate((element) => element.getBoundingClientRect().top);
  await input.fill("This conversation's draft");
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "history-80", createdAt: 1080, payload: { text: "Arrived while reading" } }));
  for (let index = 0; index < 20; index++) channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: `earlier-${index}`,
    createdAt: index, payload: { text: `Earlier replay ${index}` } }));
  await expect(rows).toHaveCount(51);
  await expect(page.getByTestId("message-history-30")).toHaveCount(1);
  await expect(page.getByTestId("message-earlier-0")).toHaveCount(0);
  await expect.poll(() => anchor.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(top, 0);
  await expect(input).toBeFocused();
  await expect(page.getByText("50 earlier messages available", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Load earlier messages", exact: true }).click();
  await expect(rows).toHaveCount(101);
  await expect(page.getByTestId("message-earlier-0")).toHaveCount(1);

  await agent(page, "Other").click();
  await expect(page.getByRole("textbox", { name: "Message Other", exact: true })).toHaveValue("");
  await expect(rows).toHaveCount(50);
  await expect(page.getByTestId("message-history-25")).toContainText("other history 25");
  await expect(page.getByTestId("message-earlier-0")).toHaveCount(0);
  await agent(page, "Live").click();
  await expect(rows).toHaveCount(50);
  await expect(page.getByTestId("message-history-31")).toHaveCount(1);
  await expect(page.getByTestId("message-history-30")).toHaveCount(0);
  await expect(input).toHaveValue("This conversation's draft");
  await expect(page.getByTestId("message-history-80")).toBeInViewport();
});

test("blank reply bodies do not bury attachments or hide completed reply announcements", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
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
  await input.fill("Keep the next draft");
  for (const [index, format] of ["markdown", "raw"].entries()) {
    channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: format, createdAt: index,
      payload: { text: " \n".repeat(300), format, attachments: [{ url: "https://example.com/report.pdf", name: "Report.pdf" }] } }));
    const reply = page.getByTestId(`message-${format}`);
    await expect(reply.getByRole("link", { name: "Report.pdf, opens in browser", exact: true })).toBeInViewport();
    await expect.poll(() => reply.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(140);
    await expect(page.getByText("Live replied: Report.pdf", { exact: true })).toHaveCount(1);
  }
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "card", createdAt: 2,
    payload: { text: "", card: { title: " \n".repeat(300), subtitle: "Next steps", text: " \n".repeat(300) } } }));
  await expect(page.getByText("Live replied: Next steps", { exact: true })).toHaveCount(1);
  await expect.poll(() => page.getByTestId("message-card").evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(140);
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "empty-stream", createdAt: 3, streaming: true,
    payload: { text: " \n".repeat(300) } }));
  const stream = page.getByTestId("message-empty-stream");
  await expect(stream.getByTestId("message-text")).toContainText("▍");
  await expect.poll(() => stream.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(140);
  channel!.send(JSON.stringify({ type: "message_done", agentId: "live", messageId: "empty-stream", interrupted: true }));
  await expect(stream).toContainText("Reply stopped before any text arrived.");
  await expect(page.getByText("Live stopped: Reply stopped before any text arrived.", { exact: true })).toHaveCount(1);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Keep the next draft");
  await noOverflow(page);
  await accessible(page);
});

for (const width of [1440, 320]) test(`expanding long tool details keeps their beginning visible while replies arrive (${width}px)`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  let channel: WebSocketRoute | undefined;
  const detail = Array.from({ length: 60 }, (_, index) => `Report line ${index + 1}: tool output`).join("\n");
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "hello") return;
      socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      for (let index = 0; index < 16; index++) socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: `history-${index}`,
        createdAt: index, payload: { text: `History ${index}. ${"Previous content. ".repeat(12)}` } }));
      socket.send(JSON.stringify({ type: "tool_activity", agentId: "live", message: { id: "report", agentId: "live",
        role: "assistant", kind: "activity", createdAt: 20, tool: { name: "report", ok: true, detail } } }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const transcript = page.getByTestId("chat-transcript");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("Keep the next draft");
  const chip = page.getByRole("button", { name: "Tool report, Done", exact: true });
  await expect(chip).toBeInViewport();
  await chip.focus();
  const before = await transcript.evaluate((element) => ({ top: element.scrollTop, height: element.scrollHeight }));
  await chip.press("Enter");
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => transcript.evaluate((element) => element.scrollHeight)).toBeGreaterThan(before.height + 500);
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(before.top);
  await expect(chip).toBeFocused();
  await expect(chip).toBeInViewport();
  const jump = page.getByRole("button", { name: "Jump to latest", exact: true });
  await expect(jump).toBeVisible();
  await input.focus();
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "after-details", createdAt: 30, payload: { text: "New reply below the report" } }));
  await expect(page.getByTestId("message-after-details")).toHaveCount(1);
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(before.top);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Keep the next draft");
  await jump.click();
  await expect(jump).toHaveCount(0);
  await expect.poll(() => transcript.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(80);
  channel!.send(JSON.stringify({ type: "tool_activity", agentId: "live", message: { id: "short-report", agentId: "live",
    role: "assistant", kind: "activity", createdAt: 40, tool: { name: "summary", ok: true, detail: "A short summary" } } }));
  const summary = page.getByRole("button", { name: "Tool summary, Done", exact: true });
  await expect(summary).toBeInViewport();
  await summary.press("Enter");
  await expect(page.getByText("A short summary", { exact: true })).toBeInViewport();
  await expect(jump).toHaveCount(0);
  await summary.press("Enter");
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "after-summary", createdAt: 50, payload: { text: "Still following new replies" } }));
  await expect(page.getByTestId("message-after-summary")).toBeInViewport();
  await expect(jump).toHaveCount(0);
  await expect(input).toHaveValue("Keep the next draft");
  await noOverflow(page);
  await accessible(page);
});

test("responsive sidebar transitions retain filters and restore navigation focus", async ({ page }) => {
  await mockReady(page);
  const search = page.getByRole("textbox", { name: "Search agents", exact: true });
  await search.fill("Research");
  const unread = page.getByRole("button", { name: /^Unread conversations/ });
  await unread.click();
  await search.focus();
  await page.setViewportSize({ width: 390, height: 844 });
  const open = page.getByRole("button", { name: "Open agent list", exact: true });
  await expect(open).toBeFocused();
  await open.press("Enter");
  await expect(search).toHaveValue("Research");
  await expect(unread).toHaveAttribute("aria-pressed", "true");
  await expect(agent(page, "Research")).toBeVisible();
  await search.focus();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const list = page.getByRole("region", { name: "Agent list", exact: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(list).toBeFocused();
  await expect(search).toHaveValue("Research");
  await expect(unread).toHaveAttribute("aria-pressed", "true");

  const input = page.getByRole("textbox", { name: "Message Zakura", exact: true });
  await input.fill("Keep the draft and its focus while resizing");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Keep the draft and its focus while resizing");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await open.focus();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(list).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(open).toBeFocused();
  await open.press("Enter");
  await expect(search).toHaveValue("Research");
  await page.keyboard.press("Escape");
  await expect(open).toBeFocused();
  await open.press("Enter");
  await expect(search).toHaveValue("Research");
  await expect(unread).toHaveAttribute("aria-pressed", "true");
  await noOverflow(page);
  await accessible(page);
});

test("unfinished streaming code shields list markers and escaped links retain their signed destinations", async ({ page }) => {
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
  await input.fill("Keep the next draft");
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "partial-code", createdAt: 1,
    streaming: true, payload: { text: "- Actual list\nSource `line" } }));
  const reply = page.getByTestId("message-partial-code");
  await expect(reply).toContainText("• Actual list");
  channel!.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "partial-code",
    delta: "\n- [Literal](https://example.com)\n* source" }));
  await expect(reply).toContainText("- [Literal](https://example.com)");
  await expect(reply).toContainText("* source");
  await expect(reply.getByRole("link")).toHaveCount(0);
  const escapedLink = String.raw`[Download](https://files.example.com/a\_b.pdf?key\=a\+b\&sig\=q%2Br%2F\#page\=2)`;
  channel!.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "partial-code",
    delta: "`\n- " + escapedLink.slice(0, -1) }));
  await expect(reply).toContainText("line - [Literal](https://example.com) * source");
  await expect(reply).toContainText(escapedLink.slice(0, -1));
  await expect(reply.getByRole("link")).toHaveCount(0);
  channel!.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "partial-code", delta: ")" }));
  await expect(reply).toContainText("• Download");
  await expect(reply.getByRole("link", { name: "Download, opens in browser", exact: true }))
    .toHaveAttribute("href", "https://files.example.com/a_b.pdf?key=a+b&sig=q%2Br%2F#page=2");
  channel!.send(JSON.stringify({ type: "message_done", agentId: "live", messageId: "partial-code" }));
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "raw-destination", createdAt: 2,
    payload: { text: escapedLink, format: "raw" } }));
  const rawReply = page.getByTestId("message-raw-destination");
  await expect(rawReply.getByTestId("message-text")).toHaveText(escapedLink);
  await expect(rawReply.getByRole("link")).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Keep the next draft");
  await page.setViewportSize({ width: 320, height: 568 });
  await noOverflow(page);
  await accessible(page);
});

test("streamed Markdown escapes preserve literal links and list markers without changing raw replies", async ({ page }) => {
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
  await input.fill("Keep the next draft");
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "escaped", createdAt: 1,
    streaming: true, payload: { text: "\\" } }));
  const reply = page.getByTestId("message-escaped");
  await expect(reply).toContainText("\\");
  channel!.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "escaped",
    delta: "[Literal](https://example.com)\n\\- literal dash\n\\* literal star\n- real list\n" }));
  await expect(reply).toContainText("[Literal](https://example.com)");
  await expect(reply.getByRole("link")).toHaveCount(0);
  await expect(reply).toContainText("- literal dash");
  await expect(reply).toContainText("* literal star");
  await expect(reply).toContainText("• real list");
  channel!.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "escaped",
    delta: "\\` then [Docs](https://example.com/guide_(one))\n**a\\*b** and [A\\]B](https://example.com)" }));
  await expect(reply).toContainText("` then Docs");
  await expect(reply).toContainText("a*b and A]B");
  await expect(reply.getByRole("link")).toHaveCount(2);
  await expect(reply.getByRole("link", { name: "Docs, opens in browser", exact: true }))
    .toHaveAttribute("href", "https://example.com/guide_(one)");
  channel!.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "escaped",
    delta: "\n`\\[Code](https://example.com) \\*`" }));
  await expect(reply).toContainText("\\[Code](https://example.com) \\*");
  await expect(reply.getByRole("link")).toHaveCount(2);
  channel!.send(JSON.stringify({ type: "message_done", agentId: "live", messageId: "escaped" }));
  const rawText = "\\[Raw](https://example.com)\n\\- raw dash\n\\* raw star";
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "raw-escaped", createdAt: 2,
    payload: { text: rawText, format: "raw" } }));
  const rawReply = page.getByTestId("message-raw-escaped");
  await expect(rawReply.getByTestId("message-text")).toHaveText(rawText);
  await expect(rawReply.getByRole("link")).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Keep the next draft");
  await page.setViewportSize({ width: 320, height: 568 });
  await noOverflow(page);
  await accessible(page);
});

test("inline code containing backticks never activates its Markdown links", async ({ page }) => {
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
  await input.fill("Keep the next draft");
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "inline-code", createdAt: 1,
    streaming: true, payload: { text: "Use `` `[Literal](https://example.com)` `` then " } }));
  const reply = page.getByTestId("message-inline-code");
  await expect(reply).toContainText("Use `[Literal](https://example.com)` then");
  await expect(reply.getByRole("link")).toHaveCount(0);
  channel!.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "inline-code",
    delta: "[Docs](https://example.com/guide_(one))." }));
  await expect(reply.getByRole("link")).toHaveCount(1);
  await expect(reply.getByRole("link", { name: "Docs, opens in browser", exact: true }))
    .toHaveAttribute("href", "https://example.com/guide_(one)");
  channel!.send(JSON.stringify({ type: "message_done", agentId: "live", messageId: "inline-code" }));
  const partial = "Use `` [Pending](https://example.com) `tick`";
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "pending-code", createdAt: 2,
    streaming: true, payload: { text: partial } }));
  const pending = page.getByTestId("message-pending-code");
  await expect(pending).toContainText(partial);
  await expect(pending.getByRole("link")).toHaveCount(0);
  channel!.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "pending-code",
    delta: " `` then [Docs](https://example.com)." }));
  await expect(pending).toContainText("Use [Pending](https://example.com) `tick` then Docs.");
  await expect(pending.getByRole("link")).toHaveCount(1);
  await expect(pending.getByRole("link", { name: "Docs, opens in browser", exact: true })).toBeVisible();
  channel!.send(JSON.stringify({ type: "message_done", agentId: "live", messageId: "pending-code" }));
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Keep the next draft");
});

test("invalid reply payloads stay in their conversation and revoked backfill cannot create global errors", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  const roster = [{ id: "alpha", name: "Alpha", status: "idle" }, { id: "beta", name: "Beta", status: "idle" }];
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: roster }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  await agent(page, "Beta").click();
  const input = page.getByRole("textbox", { name: "Message Beta", exact: true });
  await input.fill("Keep this draft");
  const invalidReply = { type: "chat_reply", agentId: "alpha", messageId: "bad", createdAt: 1,
    payload: { attachments: ["/workspace/private-file.txt"] } };
  channel!.send(JSON.stringify(invalidReply));
  // A following valid frame makes the absence assertion independent of frame timing.
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "beta", messageId: "good", createdAt: 2, payload: { text: "Beta is ready" } }));
  await expect(page.getByTestId("message-good")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(input).toBeFocused();
  await agent(page, "Alpha").click();
  await expect(page.getByRole("alert")).toContainText("Invalid channel frame");
  await agent(page, "Beta").click();
  channel!.send(JSON.stringify({ type: "agents", agents: [roster[1]] }));
  channel!.send(JSON.stringify(invalidReply));
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "beta", messageId: "after-revocation", createdAt: 3, payload: { text: "Beta is still ready" } }));
  await expect(page.getByTestId("message-after-revocation")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(input).toHaveValue("Keep this draft");
});

test("streaming inline code keeps links literal across soft line breaks", async ({ page }) => {
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
  await input.fill("Keep this draft");
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "multiline", createdAt: 1,
    streaming: true, payload: { text: "Use `` [Literal](https://example.com)" } }));
  const reply = page.getByTestId("message-multiline");
  await expect(reply).toContainText("Use `` [Literal](https://example.com)");
  await expect(reply.getByRole("link")).toHaveCount(0);
  channel!.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "multiline", delta: "\nwith `tick`\n" }));
  await expect(reply).toContainText("`tick`");
  await expect(reply.getByRole("link")).toHaveCount(0);
  channel!.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "multiline",
    delta: "``\n- [Docs](https://example.com/guide_(one))" }));
  await expect(reply).toContainText("Use [Literal](https://example.com) with `tick`");
  await expect(reply).toContainText("• Docs");
  await expect(reply.getByRole("link")).toHaveCount(1);
  await expect(reply.getByRole("link", { name: "Docs, opens in browser", exact: true }))
    .toHaveAttribute("href", "https://example.com/guide_(one)");
  channel!.send(JSON.stringify({ type: "message_done", agentId: "live", messageId: "multiline" }));
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Keep this draft");
  await page.setViewportSize({ width: 320, height: 568 });
  await noOverflow(page);
  await accessible(page);
});

test("streaming code fences preserve embedded backticks and complete links keep balanced parentheses", async ({ page }) => {
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
  await input.fill("Keep this draft");
  const source = "const marker = '```';\n";
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "code", createdAt: 1,
    streaming: true, payload: { text: "```js\n" + source } }));
  const reply = page.getByTestId("message-code");
  await expect(reply.getByTestId("message-text")).toHaveCount(1);
  await expect(reply.getByTestId("message-text")).toHaveText(source);
  channel!.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "code",
    delta: "const url = '[Code](https://example.com)';\n```\n[Guide](https://example.com/guide_(one)?q=(two))" }));
  await expect(reply.getByTestId("message-text").first()).toHaveText(source + "const url = '[Code](https://example.com)';");
  const link = page.getByRole("link", { name: "Guide, opens in browser", exact: true });
  await expect(link).toHaveAttribute("href", "https://example.com/guide_(one)?q=(two)");
  await expect(page.getByRole("link", { name: "Code, opens in browser", exact: true })).toHaveCount(0);
  channel!.send(JSON.stringify({ type: "message_done", agentId: "live", messageId: "code" }));
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Keep this draft");
  await page.setViewportSize({ width: 320, height: 568 });
  await link.focus();
  await expect(link).toBeFocused();
  await noOverflow(page);
  await accessible(page);
});

test("late receipts clear delivery failures without hiding a separate run error or disturbing the draft", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  let sent: { clientMessageId: string; text: string } | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1,
        agents: [{ id: "live", name: "Live", status: "idle" }] }));
      if (frame.type === "send") sent = frame;
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("Earlier unconfirmed message");
  await input.press("Enter");
  await expect.poll(() => sent?.text).toBe("Earlier unconfirmed message");
  await input.fill("Keep the next draft");
  channel!.send(JSON.stringify({ type: "message", message: { id: "current", agentId: "live", role: "user", kind: "text",
    text: "A newer turn", createdAt: Date.now() + 1000 } }));
  channel!.send(JSON.stringify({ type: "error", agentId: "live", clientMessageId: "current", turnEnded: true, message: "Current run failed" }));
  await expect(page.getByRole("alert")).toContainText("Current run failed");
  channel!.send(JSON.stringify({ type: "error", agentId: "live", clientMessageId: sent!.clientMessageId, message: "Earlier delivery failed" }));
  await expect(page.getByRole("alert")).toContainText("Earlier delivery failed");
  channel!.send(JSON.stringify({ type: "message", message: { id: "server-old", clientMessageId: sent!.clientMessageId,
    agentId: "live", role: "user", kind: "text", text: sent!.text, createdAt: 1 } }));
  await expect(page.getByRole("button", { name: "Retry failed message", exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("Current run failed");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Keep the next draft");
  await page.getByRole("button", { name: "Dismiss error", exact: true }).press("Enter");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("chat-transcript")).toBeFocused();
});

test("roster revocation and changing search matches keep keyboard focus in the agent list", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  const roster = [{ id: "alpha", name: "Alpha", status: "idle" }, { id: "beta", name: "Beta", status: "idle" }];
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: roster }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Alpha", exact: true });
  await input.fill("Keep the Alpha draft");
  const search = page.getByRole("textbox", { name: "Search agents", exact: true });
  const list = page.getByRole("region", { name: "Agent list", exact: true });
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "beta", messageId: "match", createdAt: 1, payload: { text: "Search needle" } }));
  await search.fill("needle");
  await agent(page, "Beta").focus();
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "beta", messageId: "match", createdAt: 1, payload: { text: "Changed preview" } }));
  await expect(agent(page, "Beta")).toHaveCount(0);
  await expect(list).toBeFocused();
  await expect(search).toHaveValue("needle");
  await expect(input).toHaveValue("Keep the Alpha draft");
  await search.fill("");
  await agent(page, "Beta").focus();
  channel!.send(JSON.stringify({ type: "agents", agents: [roster[0]] }));
  await expect(list).toBeFocused();
  // Removing an unrelated row must not steal an active draft's focus.
  channel!.send(JSON.stringify({ type: "agents", agents: roster }));
  await expect(agent(page, "Beta")).toBeVisible();
  await input.focus();
  channel!.send(JSON.stringify({ type: "agents", agents: [roster[0]] }));
  await expect(agent(page, "Beta")).toHaveCount(0);
  await expect(input).toBeFocused();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("button", { name: "Open agent list", exact: true }).click();
  channel!.send(JSON.stringify({ type: "agents", agents: roster }));
  await agent(page, "Beta").focus();
  channel!.send(JSON.stringify({ type: "agents", agents: [roster[0]] }));
  await expect(list).toBeFocused();
  await noOverflow(page);
  await accessible(page);
});

test("revoking the focused conversation moves focus to its replacement without reusing drafts", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  const roster = [{ id: "alpha", name: "Alpha", status: "idle" }, { id: "beta", name: "Beta", status: "idle" }];
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: roster }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Message Alpha", exact: true }).fill("Revoked Alpha draft");
  channel!.send(JSON.stringify({ type: "agents", agents: [roster[1]] }));
  const transcript = page.getByRole("region", { name: "Conversation with Beta", exact: true });
  await expect(transcript).toBeFocused();
  const input = page.getByRole("textbox", { name: "Message Beta", exact: true });
  await expect(input).toHaveValue("");
  await input.fill("Revoked Beta draft");
  channel!.send(JSON.stringify({ type: "agents", agents: [] }));
  const setup = page.getByRole("region", { name: "Channel setup", exact: true });
  await expect(setup).toBeFocused();
  await expect(page.getByRole("textbox", { name: /^Message / })).toHaveCount(0);
  channel!.send(JSON.stringify({ type: "agents", agents: roster }));
  await expect(page.getByRole("region", { name: "Conversation with Alpha", exact: true })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Message Alpha", exact: true })).toHaveValue("");
  await accessible(page);
});

test("reply actions and file links make their entire padded area keyboard and touch accessible", async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await context.route("https://files.example.com/**", (route) => route.fulfill({ body: "Test destination" }));
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "hello") return;
      socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "actions", createdAt: 1, payload: {
        actions: [{ label: "Open report", url: "https:files.example.com/report?signature=a%2Bb", style: "primary" }],
        attachments: [{ url: "https://files.example.com/download.pdf", name: "Report.pdf" }],
        card: { links: [{ label: "Review details", url: "https://files.example.com/details", style: "danger" }] },
      } }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("Keep my draft");
  for (const label of ["Open report", "Report.pdf", "Review details"]) {
    const link = page.getByRole("link", { name: `${label}, opens in browser`, exact: true });
    await expect(link).toBeVisible();
    const bounds = await link.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  }
  const report = page.getByRole("link", { name: "Open report, opens in browser", exact: true });
  const popupPromise = page.waitForEvent("popup");
  await report.click({ position: { x: 4, y: 4 } });
  const popup = await popupPromise;
  await expect(popup).toHaveURL("https://files.example.com/report?signature=a%2Bb");
  await popup.close();
  const details = page.getByRole("link", { name: "Review details, opens in browser", exact: true });
  const keyboardPopupPromise = page.waitForEvent("popup");
  await details.press("Enter");
  const keyboardPopup = await keyboardPopupPromise;
  await expect(keyboardPopup).toHaveURL("https://files.example.com/details");
  await keyboardPopup.close();
  await expect(input).toHaveValue("Keep my draft");
  await noOverflow(page);
  await accessible(page);
});

test("empty-thread suggestions and disappearing error controls preserve keyboard focus and drafts", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  let sent: { clientMessageId: string; text: string } | undefined;
  let connections = 0;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "hello") {
        connections += 1;
        socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      }
      if (frame.type === "send") sent = frame;
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  const transcript = page.getByTestId("chat-transcript");
  await input.fill("Keep this draft");
  await page.getByRole("button", { name: "Say hello", exact: true }).focus();
  channel!.send(JSON.stringify({ type: "agents", agents: [{ id: "live", name: "Live", status: "offline" }] }));
  await expect(page.getByRole("button", { name: "Say hello", exact: true })).toHaveCount(0);
  await expect(transcript).toBeFocused();
  await expect(input).toHaveValue("Keep this draft");
  channel!.send(JSON.stringify({ type: "agents", agents: [{ id: "live", name: "Live", status: "idle" }] }));
  await page.getByRole("button", { name: "Say hello", exact: true }).press("Enter");
  await expect.poll(() => sent?.text).toBe("Say hello");
  await expect(transcript).toBeFocused();
  await expect(input).toHaveValue("Keep this draft");
  const reject = () => channel!.send(JSON.stringify({ type: "error", agentId: "live", clientMessageId: sent!.clientMessageId, message: "Delivery needs a retry" }));
  reject();
  await page.getByRole("button", { name: "Dismiss error", exact: true }).press("Enter");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(transcript).toBeFocused();
  // A late receipt can remove the same focused control without a click.
  reject();
  await page.getByRole("button", { name: "Dismiss error", exact: true }).focus();
  channel!.send(JSON.stringify({ type: "message", message: { id: sent!.clientMessageId, agentId: "live", role: "user", kind: "text", text: sent!.text, createdAt: 1 } }));
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(transcript).toBeFocused();
  channel!.close({ code: 4401, reason: "test explicit reconnect" });
  await page.getByRole("button", { name: "Reconnect", exact: true }).press("Enter");
  await expect.poll(() => connections).toBe(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(transcript).toBeFocused();
  await expect(input).toHaveValue("Keep this draft");
});

test("history ids that resemble day separators stay unique while replies are reordered", async ({ page }) => {
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
  await expect(page.getByRole("textbox", { name: "Message Live", exact: true })).toBeVisible();
  const reply = (id: string, createdAt: number, text: string) => channel!.send(JSON.stringify({
    type: "chat_reply", agentId: "live", messageId: id, createdAt, payload: { text },
  }));
  reply("anchor", 1, "First reply");
  reply("day_anchor", 2, "Second reply");
  await expect(page.getByTestId("message-day_anchor")).toContainText("Second reply");
  // A corrected timestamp moves the old day marker and both keyed messages.
  reply("anchor", 86_400_000, "First reply updated");
  await expect(page.getByTestId("message-anchor")).toHaveCount(1);
  await expect(page.getByTestId("message-day_anchor")).toHaveCount(1);
  await expect(page.getByTestId("message-anchor")).toContainText("First reply updated");
  await expect(page.getByTestId("chat-transcript").getByTestId("reply-content")).toHaveCount(2);
  reply("day_anchor", 86_400_001, "Second reply updated");
  await expect(page.getByTestId("message-day_anchor")).toHaveCount(1);
  await expect(page.getByTestId("message-day_anchor")).toContainText("Second reply updated");
  await expect(page.getByTestId("chat-transcript").getByTestId("reply-content")).toHaveCount(2);
});

test("delivered turn failures preserve receipts and drafts without stopping a newer reply", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  const sends: { clientMessageId: string; text: string }[] = [];
  const receipt = (index: number) => ({ type: "message", message: {
    id: `server-${index}`, clientMessageId: sends[index].clientMessageId, agentId: "live", role: "user", kind: "text",
    text: sends[index].text, createdAt: index * 10 + 1,
  } });
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1,
        agents: [{ id: "live", name: "Live", status: "idle" }] }));
      if (frame.type === "send") {
        const index = sends.push(frame) - 1;
        socket.send(JSON.stringify(receipt(index)));
        socket.send(JSON.stringify({ type: "typing", agentId: "live", active: true }));
        socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: `reply-${index}`,
          createdAt: index * 10 + 2, streaming: true, payload: { text: `Reply ${index}`, reply_to: `server-${index}` } }));
      }
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  const stop = page.getByRole("button", { name: "Stop generating", exact: true });
  const stopping = page.getByRole("button", { name: "Stopping reply", exact: true });
  await input.fill("First message");
  await input.press("Enter");
  await expect(page.getByTestId("message-reply-0")).toContainText("Reply to you");
  await input.fill("Next draft");
  await stop.press("Enter");
  await expect(stopping).toBeVisible();
  const failure = (index: number) => channel!.send(JSON.stringify({ type: "error", agentId: "live",
    clientMessageId: sends[index].clientMessageId, turnEnded: true, message: `Run ${index} failed after delivery` }));
  failure(0);
  await expect(page.getByRole("alert")).toContainText("Run 0 failed after delivery");
  await expect(page.getByTestId("message-reply-0")).toContainText("Stopped");
  await expect(page.getByRole("button", { name: "Retry failed message", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await expect(input).toHaveValue("Next draft");
  await expect(input).toBeFocused();
  channel!.send(JSON.stringify(receipt(0)));
  await expect(page.getByRole("alert")).toContainText("Run 0 failed after delivery");
  await input.press("Enter");
  await expect(page.getByTestId("message-reply-1")).toContainText("Reply 1");
  await input.fill("Keep this next draft");
  await stop.press("Enter");
  await expect(stopping).toBeVisible();
  failure(0);
  channel!.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "reply-1", delta: " continues" }));
  await expect(page.getByTestId("message-reply-1")).toContainText("Reply 1 continues");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(stopping).toBeVisible();
  failure(1);
  await expect(page.getByRole("alert")).toContainText("Run 1 failed after delivery");
  await expect(stopping).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry failed message", exact: true })).toHaveCount(0);
  await expect(input).toHaveValue("Keep this next draft");
  expect(sends).toHaveLength(2);
});

test("reconnect keeps settled stream text and tool chips while an idle roster confirms Stop", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  let connections = 0;
  let interrupts = 0;
  const stream = { type: "chat_reply", agentId: "live", messageId: "stream", createdAt: 1, streaming: true, payload: {} };
  const tool = { type: "tool_activity", agentId: "live", message: { id: "tool", agentId: "live", role: "assistant", kind: "activity",
    createdAt: 2, tool: { name: "search", detail: "Read the available sources" } } };
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "hello") {
        connections += 1;
        socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "busy" }] }));
        socket.send(JSON.stringify(stream));
        socket.send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "stream", delta: connections === 1 ? "Keep the received text" : "Stale replay" }));
        socket.send(JSON.stringify(tool));
        if (connections === 1) socket.send(JSON.stringify({ ...tool, message: { ...tool.message, tool: { ...tool.message.tool, ok: true } } }));
      }
      if (frame.type === "interrupt") interrupts += 1;
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  const reply = page.getByTestId("message-stream");
  await expect(reply).toContainText("Keep the received text");
  await expect(page.getByRole("button", { name: "Tool search, Done", exact: true })).toBeVisible();
  await input.fill("Keep this next draft");
  channel!.close({ code: 1011, reason: "test reconnect during a reply" });
  await expect.poll(() => connections).toBe(2);
  await expect(reply).toContainText("Keep the received text");
  await expect(reply).toContainText("Stopped");
  await expect(reply).not.toContainText("Stale replay");
  await expect(page.getByRole("button", { name: "Tool search, Done", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop generating", exact: true }).press("Enter");
  await expect.poll(() => interrupts).toBe(1);
  await expect(page.getByRole("button", { name: "Stopping reply", exact: true })).toBeDisabled();
  await expect(input).toBeFocused();
  channel!.send(JSON.stringify({ type: "agents", agents: [{ id: "live", name: "Live", status: "idle" }] }));
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Keep this next draft");
  channel!.send(JSON.stringify({ ...stream, streaming: false, payload: { text: "Complete server snapshot" } }));
  await expect(reply).toContainText("Complete server snapshot");
  await expect(reply).not.toContainText("Stopped");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("short sidebars scroll the search controls so keyboard-selected conversations remain visible", async ({ page }) => {
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width: 1440, height: 700 });
    await mockReady(page);
    await page.setViewportSize({ width, height: 568 });
    if (width < 768) await page.getByRole("button", { name: "Open agent list", exact: true }).click();
    const search = page.getByRole("textbox", { name: "Search agents", exact: true });
    await search.fill("Ops");
    await page.setViewportSize({ width, height: 240 });
    for (let index = 0; index < 4; index++) await page.keyboard.press("Tab");
    const choice = agent(page, "Ops");
    await expect(choice).toBeFocused();
    await expect(choice).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "Open settings", exact: true })).toBeInViewport({ ratio: 1 });
    await choice.press("Enter");
    await expect(page.getByRole("textbox", { name: "Message Ops", exact: true })).toBeVisible();
    await noOverflow(page);
  }
  await accessible(page);
});

test("pinned sidebar search never covers a conversation reached with Shift+Tab", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 568 });
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1,
        agents: Array.from({ length: 12 }, (_, index) => ({ id: `a${index}`, name: `Agent ${index}`, status: "idle" })) }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  await agent(page, "Agent 11").focus();
  for (let index = 11; index >= 0; index--) {
    if (index < 11) await page.keyboard.press("Shift+Tab");
    const choice = agent(page, `Agent ${index}`);
    await expect(choice).toBeFocused();
    await expect.poll(() => choice.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      // Intersection alone misses an opaque sticky header covering the row.
      return [rect.top + 2, rect.bottom - 2].every((y) => element.contains(document.elementFromPoint(rect.left + rect.width / 2, y)));
    })).toBe(true);
    await expect(page.getByRole("textbox", { name: "Search agents", exact: true })).toBeInViewport({ ratio: 1 });
  }
});

test("unmatched Markdown delimiters remain visible in chat_reply bodies", async ({ page }) => {
  const texts = ["**", "****", "`", "``", "````", "**not *bold**", "[".repeat(2000)];
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "hello") return;
      socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      texts.forEach((text, index) => socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: `literal-${index}`,
        createdAt: index, payload: { text } })));
      socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "formatted", createdAt: texts.length,
        payload: { text: "**Bold** and `code` with [Docs](https://example.com/docs)" } }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  for (const [index, text] of texts.entries()) {
    await expect(page.getByTestId(`message-literal-${index}`).getByTestId("message-text")).toHaveText(text);
  }
  await expect(page.getByTestId("message-formatted").getByTestId("message-text")).toHaveText("Bold and code with Docs");
  await expect(page.getByRole("link", { name: "Docs, opens in browser", exact: true })).toHaveAttribute("href", "https://example.com/docs");
  await page.setViewportSize({ width: 320, height: 568 });
  await noOverflow(page);
});

test("conflicting output receipt ids keep delivery pending until a valid echo arrives", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  let sent: { clientMessageId: string; text: string } | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "hello") {
        socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
        socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "occupied", createdAt: 1, payload: { text: "Keep the existing reply" } }));
      }
      if (frame.type === "send") {
        sent = frame;
        socket.send(JSON.stringify({ type: "message", message: { id: "occupied", agentId: "live", role: "user", kind: "text",
          clientMessageId: frame.clientMessageId, text: frame.text, createdAt: 2 } }));
      }
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("A new message");
  await input.press("Enter");
  await expect(page.getByRole("alert")).toContainText("conflicting ids");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("message-occupied")).toContainText("Keep the existing reply");
  await input.fill("Keep this next draft");
  channel!.send(JSON.stringify({ type: "message", message: { id: "valid-user", agentId: "live", role: "user", kind: "text",
    clientMessageId: sent!.clientMessageId, text: sent!.text, createdAt: 2 } }));
  await expect(page.getByTestId(`message-${sent!.clientMessageId}`)).toContainText("A new message");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await expect(input).toHaveValue("Keep this next draft");
});

test("retry and late receipts preserve keyboard focus without stealing it from a draft", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  let sent: { clientMessageId: string; text: string } | undefined;
  const seen = new Set<string>();
  const echo = () => channel!.send(JSON.stringify({ type: "message", message: {
    id: sent!.clientMessageId, clientMessageId: sent!.clientMessageId, agentId: "live", role: "user", kind: "text", text: sent!.text, createdAt: Date.now(),
  } }));
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      if (frame.type === "send") {
        sent = frame;
        if (seen.has(frame.clientMessageId)) echo();
        else {
          seen.add(frame.clientMessageId);
          socket.send(JSON.stringify({ type: "error", agentId: "live", clientMessageId: frame.clientMessageId, message: "Delivery needs a retry" }));
        }
      }
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  const transcript = page.getByTestId("chat-transcript");
  for (const recovery of ["retry", "late", "background"]) {
    await input.fill(`Message with ${recovery} recovery`);
    await input.press("Enter");
    const retry = page.getByRole("button", { name: "Retry failed message", exact: true });
    await expect(retry).toBeEnabled();
    await input.fill("Keep the next draft");
    if (recovery === "retry") await retry.press("Enter");
    else {
      if (recovery === "late") await retry.focus();
      echo();
    }
    await expect(retry).toHaveCount(0);
    await expect(recovery === "background" ? input : transcript).toBeFocused();
    await expect(input).toHaveValue("Keep the next draft");
  }
});

test("long system notices wrap inside a narrow transcript", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const notice = "reference_".repeat(150);
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "hello") return;
      socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      socket.send(JSON.stringify({ type: "message", message: { id: "notice", agentId: "live", role: "system", kind: "system", text: notice, createdAt: 1 } }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  await expect(page.getByText(notice, { exact: true })).toBeVisible();
  const transcript = page.getByTestId("chat-transcript");
  await expect.poll(() => transcript.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await transcript.focus();
  await transcript.press("Home");
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(0);
  await noOverflow(page);
});

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

test("equivalent live settings retain drafts, streams and pending delivery and Stop requests", async ({ page }) => {
  const channels: WebSocketRoute[] = [];
  const sends: { clientMessageId: string; text: string }[] = [];
  let interrupts = 0;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channels.push(socket);
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1,
        agents: [{ id: "live", name: "Live", status: "idle" }] }));
      if (frame.type === "send") sends.push(frame);
      if (frame.type === "interrupt") interrupts++;
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("Awaiting delivery");
  await input.press("Enter");
  await expect.poll(() => sends.length).toBe(1);
  await input.fill("Keep my next draft");
  channels[0].send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "reply", createdAt: Date.now(),
    streaming: true, payload: { text: "Still working" } }));
  await page.getByRole("button", { name: "Stop generating", exact: true }).click();
  await expect.poll(() => interrupts).toBe(1);
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await page.getByLabel("Zakura Base URL", { exact: true }).fill("ws://127.0.0.1:4173/api/zakurabot/ws/");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByText("Settings saved on this device.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(input).toHaveValue("Keep my next draft");
  expect(channels).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Stopping reply", exact: true })).toBeVisible();
  const user = page.getByTestId(`message-${sends[0].clientMessageId}`);
  await expect(user).toContainText("Sending…");
  channels[0].send(JSON.stringify({ type: "message", message: { id: "server-user", agentId: "live", role: "user", kind: "text",
    ...sends[0], createdAt: Date.now() } }));
  channels[0].send(JSON.stringify({ type: "message_delta", agentId: "live", messageId: "reply", delta: " on the same connection" }));
  channels[0].send(JSON.stringify({ type: "message_done", agentId: "live", messageId: "reply", interrupted: true }));
  channels[0].send(JSON.stringify({ type: "typing", agentId: "live", active: false }));
  await expect(user).not.toContainText("Sending…");
  await expect(page.getByTestId("message-reply")).toContainText("Still working on the same connection");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  expect(sends).toHaveLength(1);

  // A different credential must still isolate messages and drafts,
  // even when its roster reuses exactly the same agent ids.
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await page.getByLabel("Auth token", { exact: true }).fill("another-device-token");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByText("Settings saved on this device.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect.poll(() => channels.length).toBe(2);
  await expect(page.getByTestId("message-reply")).toHaveCount(0);
  await expect(user).toHaveCount(0);
});

test("saving unused live credentials keeps the current mock reply and next draft", async ({ page }) => {
  await mockReady(page);
  const input = page.getByRole("textbox", { name: "Message Zakura", exact: true });
  await input.fill("slow");
  await input.press("Enter");
  const reply = page.locator('[data-testid^="message-asst_"]');
  await expect(reply).toContainText("Replying…");
  await input.fill("Keep the mock draft");
  await page.getByRole("button", { name: "Open settings", exact: true }).click();
  await page.getByLabel("Zakura Base URL", { exact: true }).fill("https://next-server.example.com");
  await page.getByLabel("Auth token", { exact: true }).fill("future-device-token");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByText("Settings saved on this device.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(input).toHaveValue("Keep the mock draft");
  await expect(reply).not.toContainText("Stopped");
  await expect(reply).toContainText("Interrupted replies keep the text received so far and are marked as stopped.", { timeout: 10_000 });
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
  // Reaching the bottom with the wheel also removes the focused jump control.
  await jump.focus();
  await transcript.hover();
  await page.mouse.wheel(0, 2000);
  await expect(jump).toHaveCount(0);
  await expect(transcript).toBeFocused();
  await page.mouse.wheel(0, -700);
  await expect(jump).toBeVisible();
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

test("older backfill anchors the visible history while following remains paused", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "hello") return;
      socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      for (let index = 0; index < 20; index++) socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: `history-${index}`,
        createdAt: 100 + index, payload: { text: `History ${index}. ${"Previous content. ".repeat(12)}` } }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const transcript = page.getByTestId("chat-transcript");
  await expect(page.getByTestId("message-history-19")).toBeInViewport();
  await transcript.hover();
  await page.mouse.wheel(0, -650);
  const jump = page.getByRole("button", { name: "Jump to latest", exact: true });
  await expect(jump).toBeVisible();
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("Keep reading this message");
  const anchor = await transcript.evaluate((element) => {
    const viewport = element.getBoundingClientRect();
    const message = Array.from(element.querySelectorAll<HTMLElement>('[data-testid^="message-history-"]'))
      .find((row) => row.getBoundingClientRect().top >= viewport.top && row.getBoundingClientRect().bottom <= viewport.bottom)!;
    return { id: message.dataset.testid!, top: message.getBoundingClientRect().top, scrollTop: element.scrollTop };
  });
  for (let index = 0; index < 10; index++) channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: `older-${index}`,
    createdAt: index, payload: { text: `Earlier ${index}. ${"Older history. ".repeat(12)}` } }));
  await expect(page.getByTestId("message-older-9")).toHaveCount(1);
  await expect.poll(() => page.getByTestId(anchor.id).evaluate((element) => element.getBoundingClientRect().top)).toBe(anchor.top);
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBeGreaterThan(anchor.scrollTop);
  await expect(jump).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Keep reading this message");
  await noOverflow(page);
});

test("shrinking a multiline draft resumes following when the latest messages are back in view", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.install();
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "hello") return;
      socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      for (let index = 0; index < 30; index++) socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: `history-${index}`,
        createdAt: index, payload: { text: `History ${index}. ${"Previous content. ".repeat(12)}` } }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const transcript = page.getByTestId("chat-transcript");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  const jump = page.getByRole("button", { name: "Jump to latest", exact: true });
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await input.fill("Draft line\n".repeat(12));
    await expect.poll(() => input.evaluate((element) => element.clientHeight)).toBe(160);
    await expect.poll(() => transcript.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(5);
    await transcript.hover();
    await page.mouse.wheel(0, -160);
    await expect(jump).toBeVisible();
    await expect.poll(() => transcript.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeGreaterThan(140);
    // Finish the wheel gesture and its trailing scroll event before the
    // composer changes size, so a viewport-only change has to resume follow.
    await page.clock.runFor(200);
    await input.fill("Keep this draft");
    await expect.poll(() => input.evaluate((element) => element.clientHeight)).toBe(44);
    await expect(jump).toHaveCount(0);
    await expect.poll(() => transcript.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(5);
    channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: `after-resize-${width}`, createdAt: 50,
      payload: { text: "Still following new replies" } }));
    await expect(page.getByTestId(`message-after-resize-${width}`)).toBeInViewport();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("Keep this draft");
    await input.fill("Draft line\n".repeat(12));
    await transcript.hover();
    await page.mouse.wheel(0, -600);
    await expect(jump).toBeVisible();
    await page.clock.runFor(200);
    const readingPosition = await transcript.evaluate((element) => element.scrollTop);
    await input.fill("Keep reading earlier messages");
    await expect(jump).toBeVisible();
    expect(await transcript.evaluate((element) => element.scrollTop)).toBe(readingPosition);
    await jump.click();
    // Resize during the native smooth scroll, after it has captured the old
    // destination. Waiting for completion would hide the anchoring race.
    if (width === 1440) await page.waitForFunction((position) =>
      document.querySelector<HTMLElement>('[data-testid="chat-transcript"]')!.scrollTop > position,
    readingPosition, { polling: "raf" });
  }
});

test("changing reduced motion preserves the transcript reading position and draft focus", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type !== "hello") return;
      socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "idle" }] }));
      for (let index = 0; index < 30; index++) socket.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: `history-${index}`,
        createdAt: index, payload: { text: `History ${index}. ${"Long content. ".repeat(10)}` } }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const transcript = page.getByTestId("chat-transcript");
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBeGreaterThan(700);
  await transcript.hover();
  await page.mouse.wheel(0, -700);
  const jump = page.getByRole("button", { name: "Jump to latest", exact: true });
  await expect(jump).toBeVisible();
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("Draft while reading history");
  const previous = await transcript.evaluate((element) => element.scrollTop);
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    await page.emulateMedia({ reducedMotion });
    channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: `motion-${reducedMotion}`, createdAt: 40,
      payload: { text: "New content while reading history" } }));
    await expect(page.getByTestId(`message-motion-${reducedMotion}`)).toHaveCount(1);
    await expect(jump).toBeVisible();
    await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(previous);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("Draft while reading history");
  }
  await jump.press("Enter");
  await expect(transcript).toBeFocused();
  await expect.poll(() => transcript.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(80);
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
  // The same heading is briefly rendered before hydration opens the socket.
  await expect(page.getByText("Your channel has no agents yet. Check the agents assigned to your account.", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "Reconnect", exact: true }).press("Enter");
  await expect(alert).toHaveCount(0);
  await expect(setup).toBeFocused();
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

test("holding Enter through a turn ending cannot submit the next draft", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  const sends: string[] = [];
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      const frame = JSON.parse(String(raw));
      if (frame.type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name: "Live", status: "busy" }] }));
      if (frame.type === "send") sends.push(frame.text);
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("Review this draft before sending");
  await page.keyboard.down("Enter");
  channel!.send(JSON.stringify({ type: "typing", agentId: "live", active: false }));
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await expect(input).toHaveValue("Review this draft before sending");
  expect(sends).toEqual([]);
  await input.press("Enter");
  await expect.poll(() => sends).toEqual(["Review this draft before sending"]);
  await expect(input).toHaveValue("");
});

test("manual reconnect keeps receipt identities and recovers a pending send after conflicting history", async ({ page }) => {
  let channel: WebSocketRoute | undefined;
  let connections = 0;
  const sends: { clientMessageId: string; text: string }[] = [];
  const receipt = (index: number) => ({ type: "message", message: {
    id: `server-${index}`, clientMessageId: sends[index].clientMessageId, text: sends[index].text,
    agentId: "live", role: "user", kind: "text", createdAt: index + 1,
  } });
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
        if (sends.length === 1) socket.send(JSON.stringify(receipt(0)));
      }
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Message Live", exact: true });
  await input.fill("Same body");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toHaveAttribute("aria-busy", "false");
  await input.fill("Same body");
  await input.press("Enter");
  await expect.poll(() => sends.length).toBe(2);
  await input.fill("Keep this next draft");
  channel!.send(JSON.stringify({ type: "error", fatal: true, message: "Reconnect required" }));
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry failed message", exact: true })).toBeEnabled();
  expect(connections).toBe(2);
  expect(sends).toHaveLength(2);
  channel!.send(JSON.stringify({ ...receipt(0), message: { ...receipt(0).message, clientMessageId: sends[1].clientMessageId } }));
  await expect(page.getByRole("alert")).toContainText("conflicting ids");
  await expect(page.getByRole("button", { name: "Retry failed message", exact: true })).toBeVisible();
  channel!.send(JSON.stringify(receipt(1)));
  await expect(page.getByRole("button", { name: "Retry failed message", exact: true })).toHaveCount(0);
  await expect(page.getByTestId(`message-${sends[0].clientMessageId}`)).toHaveCount(1);
  await expect(page.getByTestId(`message-${sends[1].clientMessageId}`)).toHaveCount(1);
  await expect(input).toHaveValue("Keep this next draft");
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
});

test("long agent names and blank file labels keep narrow conversations usable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const name = `Agent_${"x".repeat(180)}`;
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [{ id: "live", name, status: "idle" }] }));
    });
  });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false })), { key: settingsKey });
  await page.goto("/");
  const input = page.getByRole("textbox", { name: `Message ${name}`, exact: true });
  await expect(input).toBeVisible();
  await expect.poll(() => input.evaluate((element) => element.clientHeight)).toBe(44);
  const transcript = page.getByTestId("chat-transcript");
  await expect.poll(() => transcript.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  channel!.send(JSON.stringify({ type: "typing", agentId: "live", active: true }));
  await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toBeVisible();
  await expect.poll(() => transcript.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: "files", createdAt: 1, payload: {
    attachments: [{ url: "https://example.com/report%20final.pdf", name: " \n " },
      { url: "http:files.example.com/report.pdf?signature=a%2Fb%2B+c&expires=42", name: "Signed report" }],
    card: { images: [{ url: "https://example.com/photo.png", alt: " \t " }] },
  } }));
  channel!.send(JSON.stringify({ type: "typing", agentId: "live", active: false }));
  const attachment = page.getByRole("link", { name: "report final.pdf, opens in browser", exact: true });
  await expect(attachment).toBeVisible();
  await attachment.focus();
  await expect(attachment).toBeFocused();
  const signedReport = page.getByRole("link", { name: "Signed report, opens in browser", exact: true });
  await expect(signedReport).toHaveAttribute("href", "http://files.example.com/report.pdf?signature=a%2Fb%2B+c&expires=42");
  expect(await signedReport.evaluate((element) => (element as HTMLAnchorElement).host)).toBe("files.example.com");
  await expect(page.getByRole("link", { name: "Open image, opens in browser", exact: true })).toBeVisible();
  await noOverflow(page);
  await accessible(page);
});
