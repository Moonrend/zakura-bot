import assert from "node:assert/strict";
import { test } from "node:test";
import { chatReducer, emptyChatState, isAgentWorking } from "../lib/chat-state";
import type { ChatMessage } from "../lib/types";
import { agents } from "./helpers";

function initial() {
  let state = chatReducer(emptyChatState(), { type: "reset", agents, messages: {} });
  state = chatReducer(state, { type: "view", visible: true });
  return chatReducer(state, { type: "connection", state: "connected" });
}
const reply = (id: string, agentId = "a", text = "Hello", createdAt = 10): ChatMessage =>
  ({ id, agentId, role: "assistant", kind: "text", text, createdAt });

test("receipts and retries resolve only their delivery error, retaining turn failures until dismissed", () => {
  let state = initial();
  const user: ChatMessage = { id: "local", agentId: "a", role: "user", kind: "text", text: "Hello", createdAt: 1 };
  state = chatReducer(state, { type: "draft", agentId: "a", text: "Next draft" });
  state = chatReducer(state, { type: "optimistic", message: user });
  const failure = { type: "error" as const, agentId: "a", clientMessageId: "local", turnEnded: true, message: "Run failed" };
  state = chatReducer(state, failure);
  state = chatReducer(state, failure);
  assert.equal(state.errors.length, 1, "repeated failures in the same scope are deduplicated");
  state = chatReducer(state, { type: "error", agentId: "a", clientMessageId: "local", message: "Delivery not confirmed" });
  assert.equal(state.errors.length, 2, "delivery and execution have independent recovery");
  state = chatReducer(state, { type: "optimistic", message: user });
  assert.deepEqual(state.errors.map((error) => error.message), ["Run failed"]);
  state = chatReducer(state, { type: "message", message: { ...user, id: "server", clientMessageId: "local" } });
  assert.equal(state.messagesByAgent.a.length, 1);
  assert.equal(state.messagesByAgent.a[0].failed, false);
  assert.equal(state.errors[0].turnEnded, true);
  assert.equal(state.draftsByAgent.a, "Next draft");
  state = chatReducer(state, { type: "dismiss_error", error: state.errors[0] });
  assert.equal(state.errors.length, 0);
});

test("an older unconfirmed turn error becomes a delivery error that a late receipt can clear", () => {
  let state = initial();
  const user = (id: string, createdAt: number): ChatMessage =>
    ({ id, agentId: "a", role: "user", kind: "text", text: id, createdAt });
  state = chatReducer(state, { type: "optimistic", message: user("old", 1) });
  state = chatReducer(state, { type: "message", message: user("new", 2) });
  state = chatReducer(state, { type: "typing", agentId: "a", active: true });
  state = chatReducer(state, { type: "message", message: { ...reply("current", "a", "New reply", 3), streaming: true } });
  state = chatReducer(state, { type: "error", agentId: "a", clientMessageId: "old", turnEnded: true, message: "Earlier turn failed" });
  assert.equal(state.messagesByAgent.a[0].failed, true);
  assert.equal(isAgentWorking(state, "a"), true);
  assert.notEqual(state.errors[0].turnEnded, true, "the reducer must retain its own correlation decision");
  state = chatReducer(state, { type: "message", message: user("old", 1) });
  assert.equal(state.errors.length, 0);
  assert.equal(state.messagesByAgent.a[0].failed, false);
  assert.equal(state.messagesByAgent.a.at(-1)?.streaming, true);
});

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

test("conflicting user snapshots cannot rewrite pending or delivered message bodies", () => {
  let state = initial();
  const user: ChatMessage = { id: "local", agentId: "a", role: "user", kind: "text", text: "Original body", createdAt: 10 };
  const echo = { ...user, id: "server", clientMessageId: "local" };
  state = chatReducer(state, { type: "optimistic", message: user });
  state = chatReducer(state, { type: "message", message: { ...echo, text: "Different body" } });
  assert.equal(state.messagesByAgent.a[0].text, user.text);
  assert.equal(state.messagesByAgent.a[0].pending, true, "an invalid receipt is not delivery confirmation");
  state = chatReducer(state, { type: "message", message: echo });
  state = chatReducer(state, { type: "draft", agentId: "a", text: "Next draft" });
  // Keep this transcript safe even if a replacement client has no receipt cache.
  state = chatReducer(state, { type: "connection", state: "connecting" });
  state = chatReducer(state, { type: "connection", state: "connected" });
  state = chatReducer(state, { type: "message", message: { ...echo, clientMessageId: undefined, text: "Corrupt replay" } });
  assert.equal(state.messagesByAgent.a.length, 1);
  assert.equal(state.messagesByAgent.a[0].text, user.text);
  assert.equal(state.messagesByAgent.a[0].pending, false);
  assert.equal(state.messagesByAgent.a[0].serverId, "server");
  assert.equal(state.draftsByAgent.a, "Next draft");
});

test("replacement-client receipts cannot retarget existing user ids or reply aliases", () => {
  let state = initial();
  const user = (id: string): ChatMessage => ({ id, agentId: "a", role: "user", kind: "text", text: "Same body", createdAt: 10 });
  state = chatReducer(state, { type: "optimistic", message: user("first") });
  state = chatReducer(state, { type: "message", message: { ...user("server-first"), clientMessageId: "first" } });
  state = chatReducer(state, { type: "optimistic", message: user("second") });
  state = chatReducer(state, { type: "connection", state: "connecting" });
  state = chatReducer(state, { type: "connection", state: "connected" });
  const before = state;
  for (const message of [
    { ...user("server-first"), clientMessageId: "second" },
    { ...user("different-server"), clientMessageId: "first" },
    { ...user("server-first"), clientMessageId: "different-client" },
  ]) {
    assert.equal(chatReducer(state, { type: "message", message }), before, "conflicting ids must not confirm or reassign a user message");
  }
  // A new client's replay without a correlation field falls back to its server id.
  state = chatReducer(state, { type: "message", message: { ...user("server-first"), clientMessageId: "server-first" } });
  assert.equal(state.messagesByAgent.a[0].clientMessageId, "first");
  assert.equal(state.messagesByAgent.a[0].serverId, "server-first");
  assert.equal(state.messagesByAgent.a[1].failed, true);
  state = chatReducer(state, { type: "message", message: { ...user("server-second"), clientMessageId: "second" } });
  assert.equal(state.messagesByAgent.a[1].failed, false, "a valid late receipt still confirms delivery");
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
  assert.equal(isAgentWorking(state, "a"), true);
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
  assert.equal(isAgentWorking(state, "a"), true);
  assert.equal(state.messagesByAgent.a[0].failed, true);
  assert.equal(state.messagesByAgent.a[2].streaming, true);
  state = chatReducer(state, { type: "error", agentId: "a", message: "Interrupt denied", turnEnded: false });
  assert.equal(isAgentWorking(state, "a"), true);
  state = chatReducer(state, { type: "message_delta", agentId: "a", messageId: "stream", delta: " continues" });
  assert.equal(state.messagesByAgent.a[2].text, "Answer continues");
});

test("delivery-only retries and history echoes never fabricate a new agent turn", () => {
  let state = initial();
  const user = { ...reply("local", "a", "Hello", 1), role: "user" as const };
  state = chatReducer(state, { type: "optimistic", message: user });
  assert.equal(isAgentWorking(state, "a"), false);
  assert.equal(state.agents[0].preview, "Sending · Hello");
  state = chatReducer(state, { type: "agents", agents });
  state = chatReducer(state, { type: "connection", state: "error" });
  state = chatReducer(state, { type: "connection", state: "connected" });
  state = chatReducer(state, { type: "optimistic", message: user });
  state = chatReducer(state, { type: "message", message: { ...user, id: "server", clientMessageId: "local" } });
  state = chatReducer(state, { type: "message", message: reply("history", "a", "Already completed", 2) });
  assert.equal(state.messagesByAgent.a.length, 2);
  assert.equal(state.messagesByAgent.a[0].pending, false);
  assert.equal(isAgentWorking(state, "a"), false);
  state = chatReducer(state, { type: "typing", agentId: "a", active: true });
  state = chatReducer(state, { type: "agents", agents });
  assert.equal(isAgentWorking(state, "a"), true, "an explicit live turn still survives a roster refresh");
});

test("an idle roster recovers a busy handshake snapshot without losing explicit live work", () => {
  let state = initial();
  state = chatReducer(state, { type: "agents", agents: [{ ...agents[0], status: "busy" }, agents[1]] });
  assert.equal(isAgentWorking(state, "a"), true);
  state = chatReducer(state, { type: "agents", agents });
  assert.equal(isAgentWorking(state, "a"), false);
  state = chatReducer(state, { type: "message", message: { ...reply("stream"), streaming: true } });
  state = chatReducer(state, { type: "agents", agents });
  assert.equal(isAgentWorking(state, "a"), true);
  state = chatReducer(state, { type: "message_done", agentId: "a", messageId: "stream" });
  assert.equal(isAgentWorking(state, "a"), false, "a lone stream must not invent an endless typing pulse");
});

test("older history interleaved with live replies preserves read state and chronological previews", () => {
  let state = initial();
  state = chatReducer(state, { type: "message", message: reply("latest", "a", "Seen live", 100) });
  state = chatReducer(state, { type: "select", agentId: "b" });
  state = chatReducer(state, { type: "connection", state: "error" });
  state = chatReducer(state, { type: "agents", agents });
  state = chatReducer(state, { type: "connection", state: "connected" });
  state = chatReducer(state, { type: "message", message: reply("older", "a", "History backfill", 50) });
  assert.equal(state.agents[0].unread, false);
  assert.equal(state.agents[0].preview, "Seen live");
  assert.deepEqual(state.messagesByAgent.a.map((message) => message.id), ["older", "latest"]);
  state = chatReducer(state, { type: "message", message: reply("same-time", "a", "Another reply", 100) });
  assert.equal(state.agents[0].unread, true, "distinct live posts can share a timestamp");
  state = chatReducer(state, { type: "select", agentId: "a" });
  state = chatReducer(state, { type: "message", message: { ...reply("stream", "a", "", 101), streaming: true } });
  state = chatReducer(state, { type: "select", agentId: "b" });
  state = chatReducer(state, { type: "message_delta", agentId: "a", messageId: "stream", delta: "New tokens" });
  assert.equal(state.agents[0].unread, true);
  state = chatReducer(state, { type: "agents", agents: [agents[1]] });
  assert.equal(state.readThroughByAgent.a, undefined);
});

test("replayed tool starts cannot resurrect completed, cancelled or disconnected chips", () => {
  for (const terminal of ["done", "stopped", "disconnected"] as const) {
    let state = initial();
    const message: ChatMessage = { ...reply("tool"), kind: "activity", tool: { name: "search" } };
    state = chatReducer(state, { type: "tool_activity", agentId: "a", message });
    assert.equal(isAgentWorking(state, "a"), true);
    if (terminal === "done") state = chatReducer(state, { type: "tool_activity", agentId: "a", message: { ...message, tool: { name: "search", ok: true } } });
    else if (terminal === "stopped") state = chatReducer(state, { type: "typing", agentId: "a", active: false });
    else state = chatReducer(state, { type: "connection", state: "error" });
    const settled = state.messagesByAgent.a[0];
    state = chatReducer(state, { type: "tool_activity", agentId: "a", message });
    assert.equal(state.messagesByAgent.a[0], settled);
    assert.equal(isAgentWorking(state, "a"), false);
  }
});

test("replacement-client stream announcements preserve settled text until a complete snapshot arrives", () => {
  for (const terminal of ["done", "stopped", "disconnected"] as const) {
    let state = initial();
    state = chatReducer(state, { type: "draft", agentId: "a", text: "Keep the next draft" });
    state = chatReducer(state, { type: "message", message: { ...reply("stream", "a", ""), streaming: true } });
    state = chatReducer(state, { type: "message_delta", agentId: "a", messageId: "stream", delta: "Keep the received text" });
    if (terminal === "done") state = chatReducer(state, { type: "message_done", agentId: "a", messageId: "stream" });
    else if (terminal === "stopped") state = chatReducer(state, { type: "typing", agentId: "a", active: false });
    else state = chatReducer(state, { type: "connection", state: "error" });
    state = chatReducer(state, { type: "connection", state: "connected" });
    state = chatReducer(state, { type: "select", agentId: "b" });
    const settled = state.messagesByAgent.a[0];
    state = chatReducer(state, { type: "message", message: { ...reply("stream", "a", ""), streaming: true } });
    state = chatReducer(state, { type: "message_delta", agentId: "a", messageId: "stream", delta: "Replayed tokens" });
    assert.equal(state.messagesByAgent.a[0], settled);
    assert.equal(isAgentWorking(state, "a"), false);
    assert.equal(state.agents[0].unread, false);
    assert.equal(state.draftsByAgent.a, "Keep the next draft");
    state = chatReducer(state, { type: "message", message: { ...reply("stream", "a", "Complete server snapshot"), streaming: false, interrupted: false } });
    assert.equal(state.messagesByAgent.a[0].text, "Complete server snapshot");
    assert.equal(state.messagesByAgent.a[0].interrupted, false);
  }
});

test("a delivered message stays delivered when its correlated turn fails, and older turn errors stay scoped", () => {
  let state = initial();
  const user = { ...reply("local", "a", "First", 1), role: "user" as const };
  state = chatReducer(state, { type: "optimistic", message: user });
  state = chatReducer(state, { type: "message", message: { ...user, id: "server", clientMessageId: "local" } });
  state = chatReducer(state, { type: "typing", agentId: "a", active: true });
  state = chatReducer(state, { type: "message", message: { ...reply("stream", "a", "Partial", 2), streaming: true } });
  state = chatReducer(state, { type: "draft", agentId: "a", text: "Keep this draft" });
  const error = { type: "error" as const, agentId: "a", clientMessageId: "local", turnEnded: true, message: "Run failed" };
  state = chatReducer(state, error);
  assert.equal(isAgentWorking(state, "a"), false);
  assert.equal(state.messagesByAgent.a[0].failed, false);
  assert.equal(state.messagesByAgent.a[0].pending, false);
  assert.equal(state.messagesByAgent.a[1].text, "Partial");
  assert.equal(state.messagesByAgent.a[1].interrupted, true);
  assert.equal(state.draftsByAgent.a, "Keep this draft");
  assert.equal(state.errors.at(-1)?.message, "Run failed");
  // Replaying the receipt only confirms delivery; it cannot dismiss a run error.
  state = chatReducer(state, { type: "message", message: { ...user, id: "server", clientMessageId: "local" } });
  assert.equal(state.errors.at(-1)?.message, "Run failed");
  state = chatReducer(state, { type: "message", message: { ...reply("new", "a", "Second", 3), role: "user" } });
  state = chatReducer(state, { type: "typing", agentId: "a", active: true });
  state = chatReducer(state, { type: "message", message: { ...reply("new-stream", "a", "New reply", 4), streaming: true } });
  const before = state;
  assert.equal(chatReducer(state, error), before);
  assert.equal(isAgentWorking(state, "a"), true);
});

test("an unconfirmed or rejected send cannot clear typing before the first visible reply", () => {
  let state = initial();
  state = chatReducer(state, { type: "optimistic", message: { ...reply("user"), role: "user" } });
  state = chatReducer(state, { type: "typing", agentId: "a", active: true });
  state = chatReducer(state, { type: "error", agentId: "a", clientMessageId: "user", message: "Delivery not confirmed" });
  assert.equal(state.messagesByAgent.a[0].failed, true);
  assert.equal(isAgentWorking(state, "a"), true);
  state = chatReducer(state, { type: "agents", agents });
  assert.equal(isAgentWorking(state, "a"), true);
  state = chatReducer(state, { type: "typing", agentId: "a", active: false });
  assert.equal(isAgentWorking(state, "a"), false);
});
