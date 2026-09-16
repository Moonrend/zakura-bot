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
const reply = (id: string, agentId = "a", text = "Hello", createdAt = 10): ChatMessage =>
  ({ id, agentId, role: "assistant", kind: "text", text, createdAt });

test("drafts belong to agents and switching identity clears old channel data", () => {
  let state = initial();
  state = chatReducer(state, { type: "draft", agentId: "a", text: "Draft A" });
  state = chatReducer(state, { type: "select", agentId: "b" });
  state = chatReducer(state, { type: "draft", agentId: "b", text: "Draft B" });
  state = chatReducer(state, { type: "select", agentId: "a" });
  assert.deepEqual(state.draftsByAgent, { a: "Draft A", b: "Draft B" });
  state = chatReducer(state, { type: "reset", agents: [], messages: {} });
  assert.deepEqual(state.draftsByAgent, {});
  assert.equal(state.selectedId, "");
});

test("streaming updates previews and unread after leaving the conversation; replay does not re-mark read", () => {
  let state = initial();
  state = chatReducer(state, { type: "message", message: { ...reply("r", "a", ""), streaming: true } });
  assert.equal(state.agents[0].unread, false);
  state = chatReducer(state, { type: "select", agentId: "b" });
  state = chatReducer(state, { type: "message_delta", agentId: "a", messageId: "r", delta: "New reply" });
  assert.equal(state.agents[0].unread, true);
  assert.equal(state.agents[0].preview, "New reply");
  state = chatReducer(state, { type: "select", agentId: "a" });
  state = chatReducer(state, { type: "select", agentId: "b" });
  state = chatReducer(state, { type: "message", message: { ...reply("r", "a", "New reply"), streaming: false } });
  assert.equal(state.agents[0].unread, false);
  state = chatReducer(state, { type: "select", agentId: "a" });
  state = chatReducer(state, { type: "view", visible: false });
  state = chatReducer(state, { type: "message", message: reply("r2") });
  assert.equal(state.agents[0].unread, true);
  state = chatReducer(state, { type: "view", visible: true });
  assert.equal(state.agents[0].unread, false);
});

test("server echoes and retries retain one user bubble even when the server remaps ids", () => {
  let state = initial();
  const user: ChatMessage = { id: "local", agentId: "a", role: "user", kind: "text", text: "Hi", createdAt: 10 };
  state = chatReducer(state, { type: "optimistic", message: user });
  assert.equal(state.messagesByAgent.a[0].pending, true);
  state = chatReducer(state, { type: "error", agentId: "a", clientMessageId: "local", message: "Not acknowledged" });
  assert.equal(state.messagesByAgent.a[0].failed, true);
  state = chatReducer(state, { type: "optimistic", message: user });
  state = chatReducer(state, { type: "message", message: { ...user, id: "server", clientMessageId: "local", createdAt: 11 } });
  assert.equal(state.messagesByAgent.a.length, 1);
  assert.equal(state.messagesByAgent.a[0].id, "local");
  assert.equal(state.messagesByAgent.a[0].serverId, "server");
  assert.equal(state.messagesByAgent.a[0].pending, false);
  assert.equal(state.messagesByAgent.a[0].failed, false);
  assert.equal(state.errors.length, 0);
});

test("older tool updates neither replace the latest preview nor mark a conversation unread", () => {
  let state = initial();
  state = chatReducer(state, { type: "message", message: reply("r", "a", "Latest reply", 20) });
  state = chatReducer(state, { type: "select", agentId: "b" });
  state = chatReducer(state, { type: "tool_activity", agentId: "a", message: {
    id: "tool", agentId: "a", role: "assistant", kind: "activity", createdAt: 15, tool: { name: "search", ok: true },
  } });
  assert.equal(state.agents[0].preview, "Latest reply");
  assert.equal(state.agents[0].unread, false);
  assert.deepEqual(state.messagesByAgent.a.map((message) => message.id), ["tool", "r"]);
});

test("updated timestamps are ordered, and equal timestamps remain stable", () => {
  let state = initial();
  for (const message of [reply("one", "a", "one", 1), reply("two", "a", "two", 2), reply("three", "a", "three", 2)]) {
    state = chatReducer(state, { type: "message", message });
  }
  state = chatReducer(state, { type: "message", message: reply("two", "a", "two updated", 2) });
  assert.deepEqual(state.messagesByAgent.a.map((message) => message.id), ["one", "two", "three"]);
  state = chatReducer(state, { type: "message", message: reply("one", "a", "one updated", 3) });
  assert.deepEqual(state.messagesByAgent.a.map((message) => message.id), ["two", "three", "one"]);
  assert.equal(state.agents[0].preview, "one updated");
});

test("finishing one chat_reply does not end a turn with multiple replies", () => {
  let state = initial();
  state = chatReducer(state, { type: "typing", agentId: "a", active: true });
  state = chatReducer(state, { type: "message", message: { ...reply("r"), streaming: true } });
  state = chatReducer(state, { type: "message_done", agentId: "a", messageId: "r" });
  state = chatReducer(state, { type: "message_delta", agentId: "a", messageId: "r", delta: "late" });
  assert.equal(state.typing.a, true);
  assert.equal(state.messagesByAgent.a[0].text, "Hello");
  state = chatReducer(state, { type: "typing", agentId: "a", active: false });
  assert.equal(state.typing.a, false);
});

test("disconnect settles streams, tools and unacknowledged sends without losing drafts", () => {
  let state = initial();
  state = chatReducer(state, { type: "draft", agentId: "a", text: "Next message" });
  state = chatReducer(state, { type: "optimistic", message: { ...reply("user"), role: "user" } });
  state = chatReducer(state, { type: "message", message: { ...reply("stream"), streaming: true } });
  state = chatReducer(state, { type: "tool_activity", agentId: "b", message: {
    id: "tool", agentId: "b", role: "assistant", kind: "activity", createdAt: 15, tool: { name: "search" },
  } });
  state = chatReducer(state, { type: "connection", state: "error", detail: "Network lost" });
  assert.equal(state.messagesByAgent.a.find((message) => message.id === "user")?.failed, true);
  assert.equal(state.messagesByAgent.a.find((message) => message.id === "stream")?.interrupted, true);
  assert.equal(state.messagesByAgent.b[0].tool?.interrupted, true);
  assert.equal(state.agents.some((agent) => agent.status === "busy"), false);
  assert.deepEqual(state.typing, {});
  assert.equal(state.draftsByAgent.a, "Next message");
});

test("roster removal prunes inaccessible conversations and errors stay scoped to their agent", () => {
  let state = initial();
  state = chatReducer(state, { type: "message", message: reply("a1") });
  state = chatReducer(state, { type: "message", message: reply("b1", "b") });
  state = chatReducer(state, { type: "draft", agentId: "b", text: "Private draft" });
  state = chatReducer(state, { type: "error", agentId: "a", message: "A failed" });
  state = chatReducer(state, { type: "error", agentId: "b", message: "B failed" });
  assert.equal(state.errors.length, 2);
  state = chatReducer(state, { type: "select", agentId: "b" });
  state = chatReducer(state, { type: "agents", agents: [agents[0]] });
  assert.equal(state.selectedId, "a");
  assert.equal(state.messagesByAgent.b, undefined);
  assert.equal(state.draftsByAgent.b, undefined);
  assert.deepEqual(state.errors.map((error) => error.message), ["A failed"]);
  const previous = state;
  state = chatReducer(state, { type: "message", message: reply("unknown", "b") });
  assert.equal(state, previous);
});

test("late acknowledgements clear delivery errors and echoes without a client id retain their bubble", () => {
  let state = initial();
  const user: ChatMessage = { id: "local", agentId: "a", role: "user", kind: "text", text: "Hello", createdAt: 1 };
  state = chatReducer(state, { type: "optimistic", message: user });
  state = chatReducer(state, { type: "error", agentId: "a", clientMessageId: "local", message: "Not confirmed" });
  state = chatReducer(state, { type: "message", message: { ...user, id: "server", clientMessageId: "local" } });
  assert.equal(state.errors.length, 0);
  state = chatReducer(state, { type: "message", message: { ...user, id: "server" } });
  assert.equal(state.messagesByAgent.a.length, 1);
  assert.equal(state.messagesByAgent.a[0].id, "local");
  assert.equal(state.messagesByAgent.a[0].serverId, "server");
  assert.equal(state.messagesByAgent.a[0].clientMessageId, "local");
});

test("a message id collision cannot replace a user bubble with an assistant reply or tool", () => {
  let state = initial();
  state = chatReducer(state, { type: "message", message: { ...reply("shared"), role: "user" } });
  const before = state;
  state = chatReducer(state, { type: "message", message: reply("shared", "a", "Overwritten") });
  assert.equal(state, before);
  state = chatReducer(state, { type: "tool_activity", agentId: "a", message: {
    ...reply("shared"), kind: "activity", tool: { name: "chat_reply" },
  } });
  assert.equal(state, before);
});

test("roster refresh preserves ongoing work and offline previews reflect failed delivery", () => {
  let state = initial();
  state = chatReducer(state, { type: "optimistic", message: { ...reply("user"), role: "user" } });
  state = chatReducer(state, { type: "message", message: { ...reply("stream"), streaming: true } });
  state = chatReducer(state, { type: "agents", agents });
  assert.equal(state.typing.a, true);
  assert.equal(state.agents[0].status, "busy");
  state = chatReducer(state, { type: "agents", agents: [{ ...agents[0], status: "offline" }, agents[1]] });
  assert.equal(state.typing.a, false);
  assert.equal(state.messagesByAgent.a[0].failed, true);
  assert.equal(state.messagesByAgent.a[1].interrupted, true);
  let onlyUser = initial();
  onlyUser = chatReducer(onlyUser, { type: "optimistic", message: { ...reply("user"), role: "user" } });
  onlyUser = chatReducer(onlyUser, { type: "agents", agents: [{ ...agents[0], status: "offline" }] });
  assert.equal(onlyUser.agents[0].preview, "Not sent · Hello");
});

test("selecting an agent while its thread is hidden does not consume unread replies", () => {
  let state = initial();
  state = chatReducer(state, { type: "view", visible: false });
  state = chatReducer(state, { type: "message", message: reply("new", "b") });
  state = chatReducer(state, { type: "select", agentId: "b" });
  assert.equal(state.agents[1].unread, true);
  state = chatReducer(state, { type: "view", visible: true });
  assert.equal(state.agents[1].unread, false);
});

test("an older send timeout or a failed interrupt does not stop the current reply", () => {
  let state = initial();
  state = chatReducer(state, { type: "optimistic", message: { ...reply("old", "a", "First", 1), role: "user" } });
  state = chatReducer(state, { type: "typing", agentId: "a", active: false });
  state = chatReducer(state, { type: "optimistic", message: { ...reply("new", "a", "Second", 2), role: "user" } });
  state = chatReducer(state, { type: "message", message: { ...reply("stream", "a", "Answer", 3), streaming: true } });
  state = chatReducer(state, { type: "error", agentId: "a", clientMessageId: "old", message: "Old send not confirmed" });
  assert.equal(state.typing.a, true);
  assert.equal(state.messagesByAgent.a[0].failed, true);
  assert.equal(state.messagesByAgent.a[2].streaming, true);
  state = chatReducer(state, { type: "error", agentId: "a", message: "Interrupt denied", turnEnded: false });
  assert.equal(state.typing.a, true);
  state = chatReducer(state, { type: "message_delta", agentId: "a", messageId: "stream", delta: " continues" });
  assert.equal(state.messagesByAgent.a[2].text, "Answer continues");
});
