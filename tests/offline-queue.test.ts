import assert from "node:assert/strict";
import { test } from "node:test";
import { chatReducer, emptyChatState, previewFromMessages } from "../lib/chat-state";
import type { ChatMessage } from "../lib/types";
import { agents } from "./helpers";

function initial() {
  let state = chatReducer(emptyChatState(), { type: "reset", agents, messages: {} });
  state = chatReducer(state, { type: "view", visible: true });
  return chatReducer(state, { type: "connection", state: "connected" });
}

const user = (id: string, text = "Hello", createdAt = 10): ChatMessage =>
  ({ id, agentId: "a", role: "user", kind: "text", text, createdAt });
const held = (id: string, text = "Hello", createdAt = 10): ChatMessage => ({ ...user(id, text, createdAt), queued: true });

test("a send held while the channel is offline becomes a queued user message", () => {
  let state = initial();
  state = chatReducer(state, { type: "queue", message: held("local") });
  const message = state.messagesByAgent.a[0];
  assert.equal(message.queued, true);
  assert.equal(message.pending, false);
  assert.equal(message.failed, false);
  assert.equal(state.agents[0].preview, "Will send · Hello");
});

test("previewFromMessages labels a queued send distinctly from pending", () => {
  assert.equal(previewFromMessages([held("local")]), "Will send · Hello");
  assert.equal(previewFromMessages([{ ...user("local"), pending: true }]), "Sending · Hello");
});

test("a dropped channel does not fail a queued send that was never written", () => {
  let state = initial();
  state = chatReducer(state, { type: "queue", message: held("local") });
  state = chatReducer(state, { type: "connection", state: "error", detail: "Network lost" });
  const message = state.messagesByAgent.a[0];
  assert.equal(message.queued, true);
  assert.equal(message.failed, false, "only an in-flight pending send is lost on disconnect");
});

test("flush converts a queued send into a pending one without changing its identity", () => {
  let state = initial();
  state = chatReducer(state, { type: "queue", message: held("local", "Hello", 5) });
  state = chatReducer(state, { type: "flush", agentId: "a", messageId: "local" });
  const message = state.messagesByAgent.a[0];
  assert.equal(message.queued, false);
  assert.equal(message.pending, true);
  assert.equal(message.failed, false);
  assert.equal(message.id, "local");
  assert.equal(message.createdAt, 5);
  assert.equal(state.agents[0].preview, "Sending · Hello");
});

test("a flushed send completes through the server echo and leaves the queue", () => {
  let state = initial();
  state = chatReducer(state, { type: "queue", message: held("local") });
  state = chatReducer(state, { type: "flush", agentId: "a", messageId: "local" });
  state = chatReducer(state, { type: "message", message: { ...user("server", "Hello", 11), clientMessageId: "local" } });
  assert.equal(state.messagesByAgent.a.length, 1);
  const message = state.messagesByAgent.a[0];
  assert.equal(message.id, "local");
  assert.equal(message.serverId, "server");
  assert.equal(message.queued, false);
  assert.equal(message.pending, false);
  assert.equal(state.agents[0].preview, "You: Hello");
});

test("cancelling a queued send removes its bubble and restores the earlier preview", () => {
  let state = initial();
  state = chatReducer(state, { type: "message", message: { id: "r", agentId: "a", role: "assistant", kind: "text", text: "Earlier reply", createdAt: 1 } });
  state = chatReducer(state, { type: "queue", message: held("local") });
  assert.equal(state.agents[0].preview, "Will send · Hello");
  state = chatReducer(state, { type: "cancel_queued", agentId: "a", messageId: "local" });
  assert.deepEqual(state.messagesByAgent.a.map((message) => message.id), ["r"]);
  assert.equal(state.agents[0].preview, "Earlier reply");
});

test("cancel_queued only removes a queued user message", () => {
  let state = initial();
  state = chatReducer(state, { type: "optimistic", message: user("pending") });
  state = chatReducer(state, { type: "queue", message: held("held") });
  assert.equal(state, chatReducer(state, { type: "cancel_queued", agentId: "a", messageId: "pending" }),
    "a pending send cannot be cancelled from the queue");
  assert.equal(state, chatReducer(state, { type: "cancel_queued", agentId: "a", messageId: "missing" }));
  state = chatReducer(state, { type: "cancel_queued", agentId: "a", messageId: "held" });
  assert.deepEqual(state.messagesByAgent.a.map((message) => message.id), ["pending"]);
});

test("flush ignores messages that are not queued and unknown ids", () => {
  let state = initial();
  state = chatReducer(state, { type: "optimistic", message: user("pending") });
  assert.equal(state, chatReducer(state, { type: "flush", agentId: "a", messageId: "pending" }));
  state = chatReducer(state, { type: "queue", message: held("held") });
  assert.equal(state, chatReducer(state, { type: "flush", agentId: "a", messageId: "missing" }));
});

test("queueing for an unknown agent is ignored", () => {
  const state = initial();
  assert.equal(state, chatReducer(state, { type: "queue", message: { id: "x", agentId: "ghost", role: "user",
    kind: "text", text: "Hi", createdAt: 1, queued: true } }));
});

test("a channel error cannot fail a queued send that was never written", () => {
  let state = initial();
  state = chatReducer(state, { type: "queue", message: held("local") });
  const next = chatReducer(state, { type: "error", agentId: "a", clientMessageId: "local", message: "Delivery not confirmed" });
  assert.equal(next, state, "a queued message is neither pending nor failed");
  assert.equal(next.messagesByAgent.a[0].failed, false);
  assert.equal(next.errors.length, 0);
});

test("queued sends are kept in order by timestamp while a later send is pending", () => {
  let state = initial();
  state = chatReducer(state, { type: "queue", message: held("first", "First", 1) });
  state = chatReducer(state, { type: "queue", message: held("second", "Second", 2) });
  assert.deepEqual(state.messagesByAgent.a.map((message) => message.id), ["first", "second"]);
  state = chatReducer(state, { type: "flush", agentId: "a", messageId: "first" });
  state = chatReducer(state, { type: "flush", agentId: "a", messageId: "second" });
  assert.deepEqual(state.messagesByAgent.a.map((message) => message.id), ["first", "second"]);
  assert.equal(state.messagesByAgent.a.every((message) => message.pending && !message.queued), true);
});
