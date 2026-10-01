import assert from "node:assert/strict";
import { test } from "node:test";
import { LiveZakuraChannelClient } from "../lib/channel/live-client";
import { chatReducer, emptyChatState } from "../lib/chat-state";
import type { ChatMessage } from "../lib/types";
import { agents } from "./helpers";

const reply = (id: string, agentId = "a", text = "Hello", createdAt = 10): ChatMessage =>
  ({ id, agentId, role: "assistant", kind: "text", text, createdAt });
const user = (id: string, agentId = "a", text = "Ask", createdAt = 5): ChatMessage =>
  ({ id, agentId, role: "user", kind: "text", text, clientMessageId: id, createdAt });

function viewed() {
  let state = chatReducer(emptyChatState(), { type: "reset", agents, messages: {} });
  state = chatReducer(state, { type: "view", visible: true });
  return chatReducer(state, { type: "connection", state: "connected" });
}

test("fetchHistory parses stored frames and forwards the seq cursor over the authed REST call", async () => {
  const calls: { url: string; authorization: string | undefined }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, authorization: new Headers(init?.headers).get("authorization") ?? undefined });
    return new Response(JSON.stringify({
      items: [
        { seq: 11, frame: { type: "message", message: { id: "u1", agentId: "a", role: "user", kind: "text",
          text: "Hi", clientMessageId: "u1", createdAt: 10 } } },
        { seq: 12, frame: { type: "chat_reply", agentId: "a", messageId: "r1", createdAt: 11, payload: { text: "Hello" } } },
        { seq: 13, frame: { type: "typing", agentId: "a", active: true } },
        { seq: 14, frame: { type: "chat_reply", agentId: "a" } },
      ],
      nextBefore: 11,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const client = new LiveZakuraChannelClient({ baseUrl: "https://zakura.example.com/prefix/", token: "tok" });
    const page = await client.fetchHistory("agent a", 50, 25);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://zakura.example.com/prefix/api/zakurabot/agents/agent%20a/history?limit=25&before=50");
    assert.equal(calls[0].authorization, "Bearer tok");
    assert.deepEqual(page.messages.map((message) => [message.id, message.role]), [["u1", "user"], ["r1", "assistant"]]);
    assert.equal(page.nextBefore, 11);
  } finally {
    globalThis.fetch = original;
  }
});

test("a backfilled older page prepends without unread and keeps chronological order", () => {
  let state = viewed();
  state = chatReducer(state, { type: "message", message: reply("live", "a", "Seen live", 200) });
  state = chatReducer(state, { type: "select", agentId: "b" });
  for (const message of [reply("page-1", "a", "Older one", 100), user("page-u", "a", "Earlier ask", 120),
    reply("page-2", "a", "Older two", 150)]) {
    state = chatReducer(state, { type: "message", message });
  }
  assert.deepEqual(state.messagesByAgent.a.map((message) => message.id), ["page-1", "page-u", "page-2", "live"]);
  assert.equal(state.agents.find((agent) => agent.id === "a")?.unread, false);
  assert.equal(state.agents.find((agent) => agent.id === "a")?.preview, "Seen live");
  assert.equal(state.readThroughByAgent.a, 200);
});

test("an older page interleaved with a live reply stays chronological and read", () => {
  let state = viewed();
  state = chatReducer(state, { type: "message", message: reply("live", "a", "Seen live", 300) });
  state = chatReducer(state, { type: "select", agentId: "b" });
  state = chatReducer(state, { type: "message", message: reply("page-1", "a", "Backfill", 250) });
  assert.equal(state.agents.find((agent) => agent.id === "a")?.unread, false);
  state = chatReducer(state, { type: "message", message: reply("live-2", "a", "Newer live", 350) });
  assert.deepEqual(state.messagesByAgent.a.map((message) => message.id), ["page-1", "live", "live-2"]);
  assert.equal(state.agents.find((agent) => agent.id === "a")?.unread, true);
});

test("a prepend below the oldest loaded row never reads as unread", () => {
  let state = viewed();
  state = chatReducer(state, { type: "message", message: user("u-late", "a", "Late ask", 500) });
  state = chatReducer(state, { type: "select", agentId: "b" });
  assert.equal(state.readThroughByAgent.a, 0);
  state = chatReducer(state, { type: "message", message: reply("page-1", "a", "Older", 100) });
  assert.deepEqual(state.messagesByAgent.a.map((message) => message.id), ["page-1", "u-late"]);
  assert.equal(state.agents.find((agent) => agent.id === "a")?.unread, false);
});
