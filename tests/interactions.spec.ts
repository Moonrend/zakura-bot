import { expect, test, type WebSocketRoute } from "@playwright/test";
import type { MessageInteraction } from "../lib/types";

test("approval and question cards keep only the request and response controls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const requests: { id: string; body: unknown }[] = [];
  const interactions: Record<string, MessageInteraction> = {
    approval: { type: "approval", requestId: "approval-request", status: "pending", title: "Send the report?",
      options: [{ id: "allow", label: "Approve", kind: "accept_once" }, { id: "deny", label: "Deny", kind: "reject_once" }] },
    question: { type: "question", requestId: "question-request", status: "pending", title: "Which format?",
      options: [{ id: "short", label: "Short", description: "OPTION_DESCRIPTION_MANUAL" }, { id: "detailed", label: "Detailed" }] },
    secret: { type: "question", requestId: "secret-request", status: "pending", title: "Access code?", secret: true },
  };
  const snapshot = (id: string) => ({ messageId: id, createdAt: Object.keys(interactions).indexOf(id) + 1, interaction: interactions[id] });
  await page.route("**/api/zakurabot/agents/live/interactions/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop()!;
    if (route.request().method() === "POST") {
      requests.push({ id, body: route.request().postDataJSON() });
      interactions[id] = { ...interactions[id], status: "answered" };
    }
    return route.fulfill({ json: snapshot(id) });
  });
  let channel: WebSocketRoute | undefined;
  await page.routeWebSocket("**/api/zakurabot/ws", (socket) => {
    channel = socket;
    socket.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "hello") socket.send(JSON.stringify({ type: "ready", protocol: 1,
        agents: [{ id: "live", name: "Live", status: "idle", capabilities: { interactions: true, files: false, desktop: false } }] }));
    });
  });
  await page.addInitScript(() => localStorage.setItem("zakura-bot.settings.v1", JSON.stringify({
    zakuraBaseUrl: "http://127.0.0.1:4173", authToken: "test-channel-token", useMockChannel: false,
  })));
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "Message Live", exact: true });
  await composer.fill("Keep my next draft");
  const show = (id: string) => channel!.send(JSON.stringify({ type: "chat_reply", agentId: "live", messageId: id,
    createdAt: snapshot(id).createdAt, payload: { interaction: interactions[id], text: "FALLBACK_INSTRUCTION_MANUAL ".repeat(30),
      card: { title: "FALLBACK_CARD", fields: [{ label: "Instructions", value: "FALLBACK_TOOL_DETAIL" }] },
      actions: [{ label: "FALLBACK_ACTION", url: "https://example.com/old-request" }] } }));

  show("approval");
  const approval = page.getByTestId("interaction-approval");
  await expect(approval).toHaveText("Send the report?ApproveDeny");
  await expect(approval.getByRole("button")).toHaveCount(2);
  await approval.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(approval.getByTestId("interaction-status")).toHaveText("Answered");
  await expect(approval.getByRole("button")).toHaveCount(0);

  show("question");
  const question = page.getByTestId("interaction-question");
  await expect(question.getByTestId("interaction-status")).toHaveCount(0);
  await question.getByRole("radio", { name: "Short", exact: true }).click();
  await question.getByRole("textbox", { name: "Your answer", exact: true }).fill("One paragraph");
  await question.getByRole("button", { name: "Send", exact: true }).click();
  await expect(question.getByTestId("interaction-status")).toHaveText("Answered");
  await expect(question.getByRole("textbox")).toHaveCount(0);

  show("secret");
  const secret = page.getByTestId("interaction-secret");
  await secret.getByLabel("Private answer", { exact: true }).fill("private-answer-fixture");
  await secret.getByRole("button", { name: "Send", exact: true }).click();
  await expect(secret.getByTestId("interaction-status")).toHaveText("Answered");
  await expect(composer).toHaveValue("Keep my next draft");
  await expect(page.getByRole("button", { name: "Review pending request", exact: true })).toHaveCount(0);
  expect(requests).toEqual([
    { id: "approval", body: { optionId: "allow" } },
    { id: "question", body: { selected: ["short"], text: "One paragraph" } },
    { id: "secret", body: { text: "private-answer-fixture" } },
  ]);
  const html = await page.locator("body").innerHTML();
  for (const hidden of ["FALLBACK_", "OPTION_DESCRIPTION_MANUAL", "private-answer-fixture", "Approval requested", "Choose one, or write an answer."]) {
    expect(html).not.toContain(hidden);
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
