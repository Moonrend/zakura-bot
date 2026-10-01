import assert from "node:assert/strict";
import { test } from "node:test";
import { chatReducer, emptyChatState } from "../lib/chat-state";
import type { ChatMessage } from "../lib/types";
import { agents } from "./helpers";

function initial() {
  let state = chatReducer(emptyChatState(), { type: "reset", agents, messages: {} });
  state = chatReducer(state, { type: "view", visible: true });
  return chatReducer(state, { type: "connection", state: "connected" });
}

const user = (id: string, text = "Hello", createdAt = 10): ChatMessage =>
  ({ id, agentId: "a", role: "user", kind: "text", text, createdAt });

test("a failed send can be deleted and clears its delivery error and preview", () => {
  let state = initial();
  state = chatReducer(state, { type: "optimistic", message: user("local") });
  state = chatReducer(state, { type: "error", agentId: "a", clientMessageId: "local", message: "Not confirmed" });
  assert.equal(state.messagesByAgent.a.length, 1);
  assert.equal(state.messagesByAgent.a[0].failed, true);
  assert.equal(state.errors.length, 1);
  state = chatReducer(state, { type: "remove_message", agentId: "a", messageId: "local" });
  assert.deepEqual(state.messagesByAgent.a, []);
  assert.equal(state.errors.length, 0);
  assert.equal(state.agents[0].preview, undefined);
});

test("deleting a failed send retains a correlated agent run failure", () => {
  let state = initial();
  state = chatReducer(state, { type: "optimistic", message: user("local") });
  state = chatReducer(state, { type: "error", agentId: "a", clientMessageId: "local", message: "Delivery not confirmed" });
  state = chatReducer(state, { type: "error", agentId: "a", clientMessageId: "local", turnEnded: true, message: "Run failed" });
  assert.equal(state.errors.length, 2);
  state = chatReducer(state, { type: "remove_message", agentId: "a", messageId: "local" });
  assert.deepEqual(state.errors.map((error) => error.message), ["Run failed"]);
});

test("delete only applies to a failed user send", () => {
  let pending = initial();
  pending = chatReducer(pending, { type: "optimistic", message: user("local") });
  assert.equal(pending, chatReducer(pending, { type: "remove_message", agentId: "a", messageId: "local" }));

  let delivered = initial();
  delivered = chatReducer(delivered, { type: "optimistic", message: user("local") });
  delivered = chatReducer(delivered, { type: "message", message: { ...user("local"), id: "server", clientMessageId: "local" } });
  assert.equal(delivered, chatReducer(delivered, { type: "remove_message", agentId: "a", messageId: "local" }));

  let assistant = initial();
  assistant = chatReducer(assistant, { type: "message", message: { id: "r", agentId: "a", role: "assistant", kind: "text", text: "Hi", createdAt: 5 } });
  assert.equal(assistant, chatReducer(assistant, { type: "remove_message", agentId: "a", messageId: "r" }));
});

test("resending a failed send keeps one bubble through the server echo", () => {
  let state = initial();
  state = chatReducer(state, { type: "optimistic", message: user("local") });
  state = chatReducer(state, { type: "error", agentId: "a", clientMessageId: "local", message: "Not confirmed" });
  assert.equal(state.messagesByAgent.a[0].failed, true);
  state = chatReducer(state, { type: "optimistic", message: user("local") });
  state = chatReducer(state, { type: "message", message: { ...user("local"), id: "server", clientMessageId: "local", createdAt: 11 } });
  assert.equal(state.messagesByAgent.a.length, 1);
  assert.equal(state.messagesByAgent.a[0].id, "local");
  assert.equal(state.messagesByAgent.a[0].serverId, "server");
  assert.equal(state.messagesByAgent.a[0].failed, false);
  assert.equal(state.messagesByAgent.a[0].pending, false);
  assert.equal(state.errors.length, 0);
});
