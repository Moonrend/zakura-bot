import assert from "node:assert/strict";
import { test } from "node:test";
import { CLIENT_INFO, validateLiveSettings, zakuraSocketUrl } from "../lib/channel/live-client";
import { decodeServerFrame } from "../lib/channel/protocol";
import { agents, liveHarness } from "./helpers";

test("socket URLs preserve prefixes and reject credentials or unsupported protocols", () => {
  assert.equal(zakuraSocketUrl(" https://example.com/zakura/ "), "wss://example.com/zakura/api/zakurabot/ws");
  assert.equal(zakuraSocketUrl("ws://localhost:8787/api/zakurabot/ws/"), "ws://localhost:8787/api/zakurabot/ws");
  for (const baseUrl of ["file:///tmp", "https://user:pass@example.com", "https://example.com?token=secret", "https://example.com/#x", "invalid"]) {
    assert.throws(() => zakuraSocketUrl(baseUrl));
    assert.ok(validateLiveSettings({ baseUrl, token: "token" }));
  }
  assert.equal(validateLiveSettings({ baseUrl: "http://localhost", token: "x" }), null);
  assert.ok(validateLiveSettings({ baseUrl: "http://localhost", token: " " }));
});

test("chat_reply normalizes raw text, quotes, attachments, cards and links", () => {
  const decoded = decodeServerFrame(JSON.stringify({ type: "chat_reply", agentId: "a", messageId: "r1", createdAt: 100,
    payload: { text: "**literal**", kind: "raw", reply_to: "u1",
      attachments: ["https://example.com/report.pdf"], actions: [{ label: "Open", url: "https://example.com" }],
      card: { title: "Summary", fields: [{ label: "Status", value: "Ready" }], table: { headers: ["Result"], rows: [["Passed"]] } } } }));
  assert.equal(decoded?.type, "chat_reply");
  if (decoded?.type !== "chat_reply") return;
  assert.equal(decoded.message.format, "raw");
  assert.equal(decoded.message.replyTo, "u1");
  assert.equal(decoded.message.role, "assistant");
  assert.deepEqual(decoded.message.attachments, [{ url: "https://example.com/report.pdf" }]);
  assert.deepEqual(decoded.message.card?.table, { headers: ["Result"], rows: [["Passed"]] });
});

test("textless channel replies remain visible; malformed and unsafe payloads are rejected", () => {
  const frame = { type: "chat_reply", agentId: "a", messageId: "r1", createdAt: 100 };
  for (const payload of [
    { attachments: [{ name: "Report", url: "https://example.com/report.pdf", type: "file" }] },
    { actions: [{ label: "View", url: "https://example.com" }] },
    { kind: "card", card: { text: "Body" } },
  ]) assert.equal(decodeServerFrame(JSON.stringify({ ...frame, payload }))?.type, "chat_reply");
  for (const value of [null, [], 1, { type: "typing", agentId: "a", active: "yes" },
    { type: "ready", protocol: 1, agents: [{ id: "__proto__", name: "Bad", status: "idle" }] },
    { ...frame, payload: {} }, { ...frame, payload: { text: 42 } },
    { ...frame, payload: { attachments: ["/workspace/report.pdf"] } },
    { ...frame, payload: { actions: [{ label: "Run", url: "javascript:alert(1)" }] } },
    { ...frame, payload: { card: { imageUrl: "file:///etc/passwd" } } },
  ]) assert.throws(() => decodeServerFrame(JSON.stringify(value)));
  assert.throws(() => decodeServerFrame("not json"));
  assert.equal(decodeServerFrame('{"type":"assistant_message","text":"private"}'), null);
});

test("connect is idempotent and authentication gates roster and message events", async (t) => {
  const { client, sockets, events } = liveHarness();
  t.after(() => client.disconnect());
  await Promise.all([client.connect(), client.connect()]);
  assert.equal(sockets.length, 1);
  const socket = sockets[0];
  socket.open();
  assert.deepEqual(socket.sent[0], { type: "hello", token: "test-token", protocol: 1, client: CLIENT_INFO });
  assert.equal(client.getConnectionState(), "connecting");
  socket.frame({ type: "typing", agentId: "a", active: true });
  assert.equal(events.some((event) => event.type === "typing"), false);
  socket.ready();
  assert.equal(client.getConnectionState(), "connected");
  assert.equal(events.filter((event) => event.type === "agents").length, 1);
});

test("only announced chat_reply messages accept deltas, and late tokens are ignored", async (t) => {
  const { client, sockets, events } = liveHarness();
  t.after(() => client.disconnect());
  await client.connect();
  const socket = sockets[0]; socket.open(); socket.ready();
  const delta = { type: "message_delta", agentId: "a", messageId: "reply", delta: "Hello" };
  socket.frame(delta);
  socket.frame({ type: "assistant_message", text: "private model text" });
  socket.frame({ type: "chat_reply", agentId: "a", messageId: "reply", createdAt: 100, streaming: true, payload: { text: "" } });
  socket.frame(delta);
  socket.frame({ type: "message_done", agentId: "a", messageId: "reply" });
  socket.frame(delta);
  assert.equal(events.filter((event) => event.type === "message_delta").length, 1);
  assert.equal(events.filter((event) => event.type === "message").length, 1);
  socket.raw("null");
  assert.equal(events.at(-1)?.type, "error");
  assert.equal(client.getConnectionState(), "connected");
});

test("a handshake timeout reconnects; disconnect cancels all scheduled retries", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { client, sockets } = liveHarness({ handshakeTimeoutMs: 100 });
  t.after(() => client.disconnect());
  await client.connect();
  t.mock.timers.tick(100);
  assert.equal(client.getConnectionState(), "error");
  t.mock.timers.tick(1000);
  assert.equal(sockets.length, 2);
  sockets[1].remoteClose(1006);
  client.disconnect();
  t.mock.timers.tick(60_000);
  assert.equal(sockets.length, 2);
  assert.equal(client.getConnectionState(), "disconnected");
});

test("authorization, protocol and fatal server errors are terminal with useful error state", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  for (const code of [1008, 4401, 4403]) {
    const { client, sockets } = liveHarness();
    await client.connect(); sockets[0].open(); sockets[0].remoteClose(code);
    t.mock.timers.tick(60_000);
    assert.equal(sockets.length, 1); assert.equal(client.getConnectionState(), "error"); client.disconnect();
  }
  for (const frame of [{ type: "ready", protocol: 2, agents: [] }, { type: "error", message: "Binding disabled", fatal: true }]) {
    const { client, sockets } = liveHarness();
    await client.connect(); sockets[0].open(); sockets[0].frame(frame);
    t.mock.timers.tick(60_000);
    assert.equal(sockets.length, 1); assert.equal(client.getConnectionState(), "error"); client.disconnect();
  }
});

test("heartbeats detect missing pong; stale socket callbacks cannot kill the new connection", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { client, sockets } = liveHarness({ heartbeatMs: 20, pongTimeoutMs: 10 });
  t.after(() => client.disconnect());
  await client.connect(); sockets[0].open(); sockets[0].ready();
  const staleClose = sockets[0].onclose;
  const staleFrame = sockets[0].onmessage;
  client.disconnect(); await client.connect();
  const socket = sockets[1]; socket.open(); socket.ready();
  staleClose?.({ code: 4401 });
  staleFrame?.({ data: '{"type":"error","message":"old error","fatal":true}' });
  assert.equal(client.getConnectionState(), "connected");
  t.mock.timers.tick(20);
  assert.equal(socket.sent.at(-1)?.type, "ping");
  socket.frame({ type: "pong" });
  t.mock.timers.tick(10);
  assert.equal(client.getConnectionState(), "connected");
  t.mock.timers.tick(10);
  t.mock.timers.tick(10);
  assert.equal(client.getConnectionState(), "error");
});

test("writes are correlated with echoed ids, rejection and acknowledgement timeouts", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { client, sockets, events } = liveHarness({ acknowledgementTimeoutMs: 100 });
  t.after(() => client.disconnect());
  await client.connect(); const socket = sockets[0]; socket.open(); socket.ready();
  await client.sendMessage({ agentId: "a", text: " hi ", clientMessageId: "local1" });
  assert.deepEqual(socket.sent.at(-1), { type: "send", agentId: "a", text: "hi", clientMessageId: "local1" });
  socket.frame({ type: "message", message: { id: "server1", clientMessageId: "local1", agentId: "a", role: "user", kind: "text", text: "hi", createdAt: 1 } });
  t.mock.timers.tick(100);
  assert.equal(events.some((event) => event.type === "error"), false);
  await client.sendMessage({ agentId: "a", text: "next", clientMessageId: "local2" });
  t.mock.timers.tick(100);
  assert.equal(events.at(-1)?.type, "error");
  assert.equal((events.at(-1) as { clientMessageId?: string }).clientMessageId, "local2");
  await client.sendMessage({ agentId: "a", text: "again", clientMessageId: "local2" });
  socket.frame({ type: "error", agentId: "a", clientMessageId: "local2", message: "Rejected" });
  const count = events.length;
  t.mock.timers.tick(100);
  assert.equal(events.length, count);
});

test("offline sends and interrupts reject; synchronous write failures are recoverable", async (t) => {
  const { client, sockets } = liveHarness(); t.after(() => client.disconnect());
  await assert.rejects(client.sendMessage({ agentId: "a", text: "hi" }));
  await assert.rejects(client.interrupt("a"));
  await client.connect(); sockets[0].open(); sockets[0].ready();
  await assert.rejects(client.sendMessage({ agentId: "a", text: " " }));
  await assert.rejects(client.sendMessage({ agentId: "a", text: "a".repeat(4001) }));
  sockets[0].throwOnSend = true;
  await assert.rejects(client.sendMessage({ agentId: "a", text: "hi" }));
  assert.equal(client.getConnectionState(), "error");
});

test("protocol enums cannot be coerced from arrays, and unsafe object keys are rejected", () => {
  const reply = { type: "chat_reply", agentId: "a", messageId: "r", createdAt: 1 };
  for (const payload of [
    { text: "Body", format: ["raw"] }, { text: "Body", kind: ["card"] },
    { actions: [{ label: "Open", url: "https://example.com", style: ["primary"] }] },
    { attachments: [{ url: "https://example.com/file", type: ["file"] }] },
    { card: { title: "   " } },
  ]) assert.throws(() => decodeServerFrame(JSON.stringify({ ...reply, payload })));
  for (const name of ["toString", "valueOf", "hasOwnProperty", "__defineGetter__", "bad\nkey"]) {
    assert.throws(() => decodeServerFrame(JSON.stringify({ type: "ready", protocol: 1, agents: [{ ...agents[0], id: name }] })));
  }
  assert.throws(() => decodeServerFrame(JSON.stringify({ type: "agents", agents: [{ ...agents[0], status: ["idle"] }] })));
  assert.equal(decodeServerFrame(JSON.stringify({ ...reply,
    payload: { card: { table: { headers: ["Task", "Status"], rows: [] } } } }))?.type, "chat_reply");
  const stopped = decodeServerFrame(JSON.stringify({ ...reply, interrupted: true, payload: {} }));
  assert.equal(stopped?.type, "chat_reply");
  if (stopped?.type === "chat_reply") assert.equal(stopped.message.interrupted, true);
  assert.throws(() => decodeServerFrame(JSON.stringify({ ...reply, streaming: true, interrupted: true, payload: {} })));
});

test("roster removal cancels pending writes and streams; unknown and offline agents cannot send", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { client, sockets, events } = liveHarness({ acknowledgementTimeoutMs: 100 });
  t.after(() => client.disconnect());
  await client.connect(); const socket = sockets[0]; socket.open(); socket.ready();
  await client.sendMessage({ agentId: "a", text: "pending", clientMessageId: "local" });
  socket.frame({ type: "chat_reply", agentId: "a", messageId: "r", createdAt: 1, streaming: true, payload: {} });
  socket.frame({ type: "agents", agents: [agents[1]] });
  const count = events.length;
  socket.frame({ type: "message_delta", agentId: "a", messageId: "r", delta: "late" });
  socket.frame({ type: "typing", agentId: "a", active: true });
  socket.frame({ type: "chat_reply", agentId: "unknown", messageId: "r", createdAt: 1, payload: { text: "hidden" } });
  t.mock.timers.tick(100);
  assert.equal(events.length, count);
  await assert.rejects(client.sendMessage({ agentId: "a", text: "removed" }));
  await assert.rejects(client.interrupt("a"));
  socket.frame({ type: "agents", agents: [{ ...agents[0], status: "offline" }, agents[1]] });
  await assert.rejects(client.sendMessage({ agentId: "a", text: "offline" }));
  socket.frame({ type: "agents", agents });
  socket.frame({ type: "message_delta", agentId: "a", messageId: "r", delta: "still late" });
  assert.equal(events.filter((event) => event.type === "message_delta").length, 0);
});

test("duplicate stream announcements and tokens after a turn ends cannot reopen a reply", async (t) => {
  const { client, sockets, events } = liveHarness(); t.after(() => client.disconnect());
  await client.connect(); const socket = sockets[0]; socket.open(); socket.ready();
  const reply = { type: "chat_reply", agentId: "a", messageId: "r", createdAt: 1, streaming: true, payload: {} };
  socket.frame(reply);
  socket.frame({ type: "message_delta", agentId: "a", messageId: "r", delta: "Hello" });
  socket.frame(reply);
  assert.equal(events.filter((event) => event.type === "message").length, 1);
  socket.frame({ type: "typing", agentId: "a", active: false });
  const count = events.length;
  socket.frame(reply);
  socket.frame({ type: "message_delta", agentId: "a", messageId: "r", delta: "late" });
  assert.equal(events.length, count);
});

test("pending idempotency keys cannot be rewritten and late rejections cannot fail accepted sends", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { client, sockets, events } = liveHarness({ acknowledgementTimeoutMs: 100 });
  t.after(() => client.disconnect());
  await client.connect(); const socket = sockets[0]; socket.open(); socket.ready();
  const input = { agentId: "a", text: "original", clientMessageId: "local" };
  await client.sendMessage(input);
  await client.sendMessage(input);
  assert.equal(socket.sent.filter((frame) => frame.type === "send").length, 1);
  await assert.rejects(client.sendMessage({ ...input, text: "different" }));
  socket.frame({ type: "message", message: { id: "server", clientMessageId: "local", agentId: "a",
    role: "user", kind: "text", text: "original", createdAt: 1 } });
  const count = events.length;
  socket.frame({ type: "error", agentId: "a", clientMessageId: "local", message: "Old rejection" });
  t.mock.timers.tick(100);
  assert.equal(events.length, count);
});

test("an error event preserves the following authorization close code and does not retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { client, sockets, events } = liveHarness(); t.after(() => client.disconnect());
  await client.connect(); const socket = sockets[0]; socket.open();
  socket.onerror?.();
  socket.remoteClose(4401);
  t.mock.timers.tick(60_000);
  assert.equal(sockets.length, 1);
  assert.match(JSON.stringify(events.at(-1)), /Authentication failed/);
});

test("disconnecting inside a ready listener cannot resurrect the connection or its heartbeat", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { client, sockets } = liveHarness({ heartbeatMs: 20, pongTimeoutMs: 10 });
  t.after(() => client.disconnect());
  client.subscribe((event) => { if (event.type === "agents") client.disconnect(); });
  await client.connect(); sockets[0].open(); sockets[0].ready();
  assert.equal(client.getConnectionState(), "disconnected");
  t.mock.timers.tick(60_000);
  assert.equal(sockets.length, 1);
});

test("failed interrupt writes trigger reconnect instead of leaving a falsely connected client", async (t) => {
  const { client, sockets } = liveHarness(); t.after(() => client.disconnect());
  await client.connect(); sockets[0].open(); sockets[0].ready();
  sockets[0].throwOnSend = true;
  await assert.rejects(client.interrupt("a"));
  assert.equal(client.getConnectionState(), "error");
});
