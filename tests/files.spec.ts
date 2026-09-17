import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const uploaded = { id: "file-one", name: "report.txt", mime: "text/plain", size: 12, type: "file",
  url: "http://127.0.0.1:4173/api/zakurabot/agents/bot/files/file-one" };
async function connectFiles(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem("zakura-bot.settings.v1")) localStorage.setItem("zakura-bot.settings.v1", JSON.stringify({
      zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-token", useMockChannel: false,
    }));
  });
  const sends: Record<string, unknown>[] = [];
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => socket.onMessage((raw) => {
    const frame = JSON.parse(String(raw));
    if (frame.type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1, agents: [
      { id: "bot", name: "Research", status: "idle", capabilities: { files: true, desktop: true, interactions: true } },
      { id: "other", name: "Other", status: "idle", capabilities: { files: true, desktop: false, interactions: false } },
    ] }));
    if (frame.type === "send") {
      sends.push(frame);
      socket.send(JSON.stringify({ type: "message", message: { id: frame.clientMessageId, clientMessageId: frame.clientMessageId,
        agentId: frame.agentId, role: "user", kind: "text", text: frame.text, attachments: [uploaded], createdAt: Date.now() } }));
    }
  }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Add attachments", exact: true })).toBeEnabled();
  return sends;
}
async function choose(page: Page, images = false, name = "report.txt", mimeType = "text/plain") {
  await page.getByRole("button", { name: "Add attachments", exact: true }).click();
  const selected = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: images ? "Choose photos" : "Choose files", exact: true }).click();
  await (await selected).setFiles({ name, mimeType, buffer: Buffer.from("File content") });
}

test("upload a file, send without text, and download the authenticated attachment", async ({ page }) => {
  let uploads = 0, downloads = 0;
  await page.route("**/api/zakurabot/agents/bot/files", (route) => {
    uploads += 1;
    expect(route.request().headers().authorization).toBe("Bearer test-token");
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data; boundary=");
    expect(route.request().postDataBuffer()?.toString()).toContain("File content");
    return route.fulfill({ status: 201, json: { file: uploaded } });
  });
  await page.route("**/api/zakurabot/agents/bot/files/file-one", (route) => {
    downloads += 1;
    expect(route.request().headers().authorization).toBe("Bearer test-token");
    return route.fulfill({ contentType: "text/plain", body: "File content" });
  });
  const sends = await connectFiles(page);
  await choose(page);
  await expect(page.getByText("12 B · Ready to send", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByTestId("attachment-file-one")).toBeVisible();
  await expect(page.locator('[data-testid^="draft-attachment-"]')).toHaveCount(0);
  expect(sends).toHaveLength(1);
  expect(sends[0]).toMatchObject({ text: "📎 report.txt", attachments: [{ fileId: "file-one" }] });
  expect(JSON.stringify(sends[0])).not.toContain(uploaded.url);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download report.txt", exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("report.txt");
  expect(await readFile((await download.path())!, "utf8")).toBe("File content");
  expect([uploads, downloads]).toEqual([1, 1]);
});

test("failed uploads can retry, stay with their bot, and can be removed", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/zakurabot/agents/bot/files", (route) => {
    attempts += 1;
    return attempts === 1 ? route.fulfill({ status: 503, json: { error: "Workspace is starting" } }) : route.fulfill({ status: 201, json: { file: uploaded } });
  });
  await connectFiles(page);
  await choose(page);
  await expect(page.getByText("Workspace is starting", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: /^Other[.,]/ }).click();
  await expect(page.locator('[data-testid^="draft-attachment-"]')).toHaveCount(0);
  await page.getByRole("button", { name: /^Research[.,]/ }).click();
  await page.getByRole("button", { name: "Retry upload report.txt", exact: true }).click();
  await expect(page.getByText("12 B · Ready to send", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove attachment report.txt", exact: true }).click();
  await expect(page.locator('[data-testid^="draft-attachment-"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  expect(attempts).toBe(2);
});

test("photo picker uploads images and blocks files over the server limit", async ({ page }) => {
  let uploads = 0;
  await page.route("**/api/zakurabot/agents/bot/files", (route) => {
    uploads += 1;
    return route.fulfill({ status: 201, json: { file: { ...uploaded, name: "photo.png", type: "image", mime: "image/png" } } });
  });
  await connectFiles(page);
  await choose(page, true, "photo.png", "image/png");
  await expect(page.getByText("12 B · Ready to send", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove attachment photo.png", exact: true }).click();
  await page.getByRole("textbox", { name: "Message Research", exact: true }).evaluate((element) => {
    const data = new DataTransfer(); data.items.add(new File([new Uint8Array(16 * 1024 * 1024 + 1)], "oversized.pdf", { type: "application/pdf" }));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(page.getByRole("alert")).toContainText("exceeds the 16 MiB file limit");
  expect(uploads).toBe(1);
});
