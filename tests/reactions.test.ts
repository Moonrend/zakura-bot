import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeServerFrame, InvalidChannelFrameError } from "../lib/channel/protocol";
import { chatReducer, emptyChatState } from "../lib/chat-state";
import { addReaction, listReactions, projectReactionPills, QUICK_REACTIONS, reactionsPath,
  removeReaction, toReactionMap, type ReactionRequest } from "../lib/reactions";
import type { ChatMessage } from "../lib/types";
import { agents, liveHarness } from "./helpers";

function initial() {
  let state = chatReducer(emptyChatState(), { type: "reset", agents, messages: {} });
  state = chatReducer(state, { type: "view", visible: true });
  return chatReducer(state, { type: "connection", state: "connected" });
}
const reply = (id: string, agentId = "a", createdAt = 10): ChatMessage =>
  ({ id, agentId, role: "assistant", kind: "text", text: "Hello", createdAt });

test("pills group by emoji, count users and mark the current user", () => {
  assert.deepEqual(projectReactionPills({ me: "👍", u2: "👍", u3: "🎉" }, "me"), [
    { emoji: "👍", count: 2, mine: true },
    { emoji: "🎉", count: 1, mine: false },
  ]);
  assert.deepEqual(projectReactionPills({ me: "🎉", u2: "👍" }, "me"), [
    { emoji: "🎉", count: 1, mine: true },
    { emoji: "👍", count: 1, mine: false },
  ]);
  assert.deepEqual(projectReactionPills({ a: "👍" }, null), [{ emoji: "👍", count: 1, mine: false }]);
  assert.deepEqual(projectReactionPills(undefined, "me"), []);
  assert.deepEqual([...QUICK_REACTIONS], ["👍", "👎", "❤️", "😂", "🎉", "😮"]);
});

test("reaction frames add, replace and remove the sender's reaction", () => {
  let state = initial();
  state = chatReducer(state, { type: "message", message: reply("m1") });
  state = chatReducer(state, { type: "reaction", messageId: "m1", emoji: "👍", userId: "u1", op: "add" });
  state = chatReducer(state, { type: "reaction", messageId: "m1", emoji: "👍", userId: "u2", op: "add" });
  assert.deepEqual(state.reactionsByAgent.a.m1, { u1: "👍", u2: "👍" });
  // One reaction per user per message: a new emoji replaces the old one.
  state = chatReducer(state, { type: "reaction", messageId: "m1", emoji: "🎉", userId: "u1", op: "add" });
  assert.deepEqual(state.reactionsByAgent.a.m1, { u1: "🎉", u2: "👍" });
  // A stale removal of an emoji that user no longer holds is a no-op.
  assert.equal(chatReducer(state, { type: "reaction", messageId: "m1", emoji: "👍", userId: "u1", op: "remove" }), state);
  state = chatReducer(state, { type: "reaction", messageId: "m1", emoji: "🎉", userId: "u1", op: "remove" });
  assert.deepEqual(state.reactionsByAgent.a.m1, { u2: "👍" });
  state = chatReducer(state, { type: "reaction", messageId: "m1", emoji: "👍", userId: "u2", op: "remove" });
  assert.equal(state.reactionsByAgent.a.m1, undefined);
});

test("reactions resolve their agent by message id and follow the store's local message key", () => {
  let state = initial();
  state = chatReducer(state, { type: "optimistic", message: { id: "local", agentId: "b", role: "user", kind: "text", text: "Hi", createdAt: 5 } });
  state = chatReducer(state, { type: "message", message: { id: "server", clientMessageId: "local", agentId: "b", role: "user", kind: "text", text: "Hi", createdAt: 5 } });
  state = chatReducer(state, { type: "reaction", messageId: "server", emoji: "❤️", userId: "u1", op: "add" });
  assert.deepEqual(state.reactionsByAgent.b.server, { u1: "❤️" });
  assert.equal(state.reactionsByAgent.b.local, undefined);
  // A reaction for a message the client has not loaded is ignored.
  assert.equal(chatReducer(state, { type: "reaction", messageId: "ghost", emoji: "👍", userId: "u1", op: "add" }), state);
  state = chatReducer(state, { type: "message", message: reply("a1", "a") });
  state = chatReducer(state, { type: "reaction", messageId: "a1", emoji: "👍", userId: "u1", op: "add" });
  assert.deepEqual(state.reactionsByAgent.a.a1, { u1: "👍" });
  assert.deepEqual(state.reactionsByAgent.b.server, { u1: "❤️" });
});

test("setReactions bulk-replaces a message and clears it when empty", () => {
  let state = initial();
  state = chatReducer(state, { type: "message", message: reply("m1") });
  state = chatReducer(state, { type: "setReactions", agentId: "a", messageId: "m1", reactions: { u1: "👍", u2: "🎉" } });
  assert.deepEqual(state.reactionsByAgent.a.m1, { u1: "👍", u2: "🎉" });
  state = chatReducer(state, { type: "setReactions", agentId: "a", messageId: "m1", reactions: {} });
  assert.equal(state.reactionsByAgent.a.m1, undefined);
  assert.equal(chatReducer(state, { type: "setReactions", agentId: "z", messageId: "m1", reactions: { u1: "👍" } }), state);
});

test("a reaction frame decodes to a typed event and rejects malformed frames", () => {
  assert.deepEqual(decodeServerFrame(JSON.stringify({ type: "reaction", messageId: "m1", emoji: "👍", userId: "u1", op: "add", at: 5 })),
    { type: "reaction", messageId: "m1", emoji: "👍", userId: "u1", op: "add", at: 5 });
  for (const bad of [
    { type: "reaction", messageId: "m1", emoji: "", userId: "u1", op: "add", at: 5 },
    { type: "reaction", messageId: "m1", emoji: "👍", userId: "u1", op: "toggle", at: 5 },
    { type: "reaction", messageId: "m1", emoji: "👍", userId: "u1", op: "add", at: "5" },
    { type: "reaction", messageId: "m1", emoji: "👍👍👍👍👍👍👍👍👍👍👍👍👍👍👍👍👍", userId: "u1", op: "add", at: 5 },
  ]) assert.throws(() => decodeServerFrame(JSON.stringify(bad)), InvalidChannelFrameError);
});

test("a decoded reaction event drives the same state change as a direct action", () => {
  let state = initial();
  state = chatReducer(state, { type: "message", message: reply("m1") });
  const frame = decodeServerFrame(JSON.stringify({ type: "reaction", messageId: "m1", emoji: "🎉", userId: "u1", op: "add", at: 5 }));
  assert.ok(frame && frame.type === "reaction");
  state = chatReducer(state, frame);
  assert.deepEqual(state.reactionsByAgent.a.m1, { u1: "🎉" });
});

test("the live client emits reaction frames without an agent id", async (t) => {
  const { client, sockets, events } = liveHarness();
  t.after(() => client.disconnect());
  let state = chatReducer(emptyChatState(), { type: "reset", agents, messages: {} });
  client.subscribe((event) => { state = chatReducer(state, event); });
  await client.connect(); sockets[0].open(); sockets[0].ready();
  state = chatReducer(state, { type: "message", message: reply("m1") });
  sockets[0].frame({ type: "reaction", messageId: "m1", emoji: "🎉", userId: "u1", op: "add", at: 5 });
  assert.deepEqual(events.find((event) => event.type === "reaction"),
    { type: "reaction", messageId: "m1", emoji: "🎉", userId: "u1", op: "add" });
  assert.deepEqual(state.reactionsByAgent.a.m1, { u1: "🎉" });
});

test("REST helpers target the message reaction path with the documented methods and bodies", async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const request: ReactionRequest = async (path, init) => {
    calls.push({ path, init });
    return {} as never;
  };
  assert.equal(reactionsPath("a/b", "m 1"), "/api/zakurabot/agents/a%2Fb/messages/m%201/reactions");
  await addReaction(request, "a", "m1", "👍");
  assert.equal(calls[0].path, reactionsPath("a", "m1"));
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { emoji: "👍" });
  assert.equal(new Headers(calls[0].init?.headers).get("content-type"), "application/json");
  assert.equal(await removeReaction(request, "a", "m1", "👍"), false);
  assert.equal(calls[1].init?.method, "DELETE");
  assert.equal(await removeReaction(async () => ({ removed: true }) as never, "a", "m1", "👍"), true);
});

test("listReactions parses valid rows and maps them per user", async () => {
  const request = async () => ({ reactions: [
    { messageId: "m1", emoji: "👍", userId: "u1", createdAt: 5 },
    { messageId: "m1", emoji: "🎉", userId: "u2", createdAt: 6 },
    { messageId: "m1", emoji: "", userId: "u3" },
    { messageId: "m1", emoji: "❤️" },
  ] });
  const rows = await listReactions(request as ReactionRequest, "a", "m1");
  assert.deepEqual(rows, [
    { messageId: "m1", emoji: "👍", userId: "u1" },
    { messageId: "m1", emoji: "🎉", userId: "u2" },
  ]);
  assert.deepEqual(toReactionMap(rows), { u1: "👍", u2: "🎉" });
  assert.deepEqual(await listReactions((async () => null) as ReactionRequest, "a", "m1"), []);
});
