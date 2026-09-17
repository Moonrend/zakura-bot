import assert from "node:assert/strict";
import { test } from "node:test";
import { CLIENT_INFO, validateLiveSettings, zakuraSocketUrl } from "../lib/channel/live-client";
import { decodeServerFrame } from "../lib/channel/protocol";
import { agents, liveHarness, networkHarness } from "./helpers";

test("receipt ids cannot collide with replies, tools or notices across reconnect", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const output = [
    { type: "chat_reply", agentId: "a", messageId: "occupied", createdAt: 1, payload: { text: "Existing reply" } },
    { type: "tool_activity", agentId: "a", message: { id: "occupied", agentId: "a", role: "assistant", kind: "activity",
      createdAt: 1, tool: { name: "search", ok: true } } },
    { type: "message", message: { id: "occupied", agentId: "a", role: "system", kind: "system", text: "Existing notice", createdAt: 1 } },
  ];
  for (const frame of output) {
    const { client, sockets, events } = liveHarness({ acknowledgementTimeoutMs: 100 });
    t.after(() => client.disconnect());
    await client.connect(); sockets[0].open(); sockets[0].ready();
    sockets[0].frame(frame);
    client.disconnect(); await client.connect();
    const socket = sockets[1]; socket.open(); socket.ready();
    await assert.rejects(client.sendMessage({ agentId: "a", clientMessageId: "occupied", text: "New body" }), /already used/);
    const input = { agentId: "a", clientMessageId: "local", text: "Pending body" };
    await client.sendMessage(input);
    const receipt = { type: "message", message: { id: "occupied", clientMessageId: "local", agentId: "a", role: "user", kind: "text",
      text: input.text, createdAt: 2 } };
    socket.frame(receipt);
    assert.match(JSON.stringify(events.at(-1)), /conflicting ids/);
    socket.frame({ ...receipt, message: { ...receipt.message, id: "server", clientMessageId: "occupied" } });
    assert.match(JSON.stringify(events.at(-1)), /conflicting ids/);
    t.mock.timers.tick(100);
    assert.match(JSON.stringify(events.at(-1)), /Delivery was not confirmed/, "a refused receipt must leave the acknowledgement deadline intact");
    await client.sendMessage(input);
    assert.equal(socket.sent.filter((event) => event.type === "send").length, 2, "the invalid receipt must not be cached as delivered");
    socket.frame({ ...receipt, message: { ...receipt.message, id: "server" } });
    assert.equal(events.at(-1)?.type, "message");
    const count = events.length;
    t.mock.timers.tick(100);
    assert.equal(events.length, count);
    // The same wire id belongs to a separate namespace in another conversation.
    await client.sendMessage({ agentId: "b", clientMessageId: "occupied", text: "Another agent" });
    socket.frame({ type: "agents", agents: [agents[1]] });
    socket.frame({ type: "agents", agents });
    await client.sendMessage({ agentId: "a", clientMessageId: "occupied", text: "After access was removed" });
    client.disconnect();
  }
});

test("conflicting output ids cannot claim user aliases or start invisible work", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { client, sockets, events } = liveHarness({ interruptTimeoutMs: 100 });
  t.after(() => client.disconnect());
  await client.connect(); const socket = sockets[0]; socket.open(); socket.ready();
  await client.sendMessage({ agentId: "a", clientMessageId: "local", text: "User body" });
  for (const id of ["local", "server"]) {
    if (id === "server") socket.frame({ type: "message", message: { id, clientMessageId: "local", agentId: "a", role: "user", kind: "text", text: "User body", createdAt: 1 } });
    for (const frame of [
      { type: "chat_reply", agentId: "a", messageId: id, createdAt: 2, streaming: true, payload: {} },
      { type: "tool_activity", agentId: "a", message: { id, agentId: "a", role: "assistant", kind: "activity", createdAt: 2, tool: { name: "search" } } },
      { type: "message", message: { id, agentId: "a", role: "system", kind: "system", text: "Overwritten", createdAt: 2 } },
    ]) {
      socket.frame(frame);
      assert.match(JSON.stringify(events.at(-1)), /conflicting ids/);
      const count = events.length;
      socket.frame({ type: "message_delta", agentId: "a", messageId: id, delta: "Invisible tokens" });
      assert.equal(events.length, count);
    }
  }
  socket.frame({ type: "chat_reply", agentId: "a", messageId: "reply", createdAt: 3, payload: { text: "Visible reply" } });
  socket.frame({ type: "tool_activity", agentId: "a", message: { id: "reply", agentId: "a", role: "assistant", kind: "activity", createdAt: 3, tool: { name: "search" } } });
  assert.match(JSON.stringify(events.at(-1)), /conflicting ids/);
  await client.interrupt("a");
  socket.frame({ type: "agents", agents });
  assert.deepEqual(events.at(-1), { type: "interrupt_pending", agentId: "a", pending: false });
  const count = events.length;
  t.mock.timers.tick(100);
  assert.equal(events.length, count, "rejected output must not prevent an idle roster from confirming Stop");
});

test("socket URLs preserve prefixes and reject credentials or unsupported protocols", () => {
  assert.equal(zakuraSocketUrl(" https://example.com/zakura/ "), "wss://example.com/zakura/api/zakurabot/ws");
  assert.equal(zakuraSocketUrl("ws://localhost:8787/api/zakurabot/ws/"), "ws://localhost:8787/api/zakurabot/ws");
  assert.equal(zakuraSocketUrl("http://localhost:8787"), "ws://localhost:8787/api/zakurabot/ws");
  assert.equal(zakuraSocketUrl("https://example.com/"), "wss://example.com/api/zakurabot/ws");
  for (const baseUrl of ["file:///tmp", "https://user:pass@example.com", "https://example.com?token=secret", "https://example.com/#x",
    "https://example.com/#", "https://example.com/?", "invalid"]) {
    assert.throws(() => zakuraSocketUrl(baseUrl));
    assert.ok(validateLiveSettings({ baseUrl, token: "token" }));
  }
  assert.equal(validateLiveSettings({ baseUrl: "http://localhost", token: "x" }), null);
  assert.ok(validateLiveSettings({ baseUrl: "http://localhost", token: " " }));
  assert.ok(validateLiveSettings({ baseUrl: "http://localhost", token: "x".repeat(257) }));
});

test("user receipts respect the same nonempty text limit as inbound messages", () => {
  const message = { id: "user", agentId: "a", role: "user", kind: "text", createdAt: 1 };
  for (const text of ["", " \n\t ", "x".repeat(4001), "😀".repeat(2001)]) {
    assert.throws(() => decodeServerFrame(JSON.stringify({ type: "message", message: { ...message, text } })));
  }
  for (const text of ["Hi", "文".repeat(4000), "😀".repeat(2000)]) {
    assert.equal(decodeServerFrame(JSON.stringify({ type: "message", message: { ...message, text } }))?.type, "message");
  }
});

test("system notices preserve their text without claiming user receipt aliases", () => {
  const frame = decodeServerFrame(JSON.stringify({ type: "message", message: {
    id: "notice", agentId: "a", role: "system", kind: "system", text: "Delivery queued", createdAt: 1, clientMessageId: "user-1",
  } }));
  assert.equal(frame?.type, "message");
  if (frame?.type !== "message") return;
  assert.equal(frame.message.text, "Delivery queued");
  assert.equal(frame.message.clientMessageId, undefined);
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

test("remote links normalize to absolute destinations before a browser can resolve them against the app", () => {
  const url = "http:files.example.com/report.pdf?signature=a%2Fb%2B+c&expires=42#page=2";
  const absolute = "http://files.example.com/report.pdf?signature=a%2Fb%2B+c&expires=42#page=2";
  const decoded = decodeServerFrame(JSON.stringify({ type: "chat_reply", agentId: "a", messageId: "links", createdAt: 1,
    payload: { attachments: [url, { url }], actions: [{ label: "Download", url }],
      card: { imageUrl: url, images: [{ url }], links: [{ label: "Report", url }] } } }));
  assert.equal(decoded?.type, "chat_reply");
  if (decoded?.type !== "chat_reply") return;
  assert.deepEqual(decoded.message.attachments?.map((file) => file.url), [absolute, absolute]);
  assert.equal(decoded.message.actions?.[0].url, absolute);
  assert.equal(decoded.message.card?.imageUrl, absolute);
  assert.equal(decoded.message.card?.images?.[0].url, absolute);
  assert.equal(decoded.message.card?.links?.[0].url, absolute);
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

test("unsupported versions are terminal even when their ready roster uses a different schema", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  for (const roster of [undefined, null, { a: { displayName: "Zakura", available: true } }]) {
    const { client, sockets, events } = liveHarness();
    t.after(() => client.disconnect());
    await client.connect(); sockets[0].open();
    sockets[0].frame({ type: "ready", protocol: 2, agents: roster });
    assert.equal(client.getConnectionState(), "error");
    assert.equal(events.some((event) => event.type === "agents"), false);
    assert.match((events.at(-1) as { detail: string }).detail, /unsupported channel protocol/);
    t.mock.timers.tick(60_000);
    assert.equal(sockets.length, 1);
  }
});

test("network loss pauses heartbeats and pending operations; reconnect never resends automatically", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const network = networkHarness();
  const { client, sockets, events } = liveHarness({ network: network.network, heartbeatMs: 20, pongTimeoutMs: 10,
    acknowledgementTimeoutMs: 100, interruptTimeoutMs: 100 });
  t.after(() => client.disconnect());
  await client.connect(); sockets[0].open(); sockets[0].ready();
  await client.sendMessage({ agentId: "a", clientMessageId: "unconfirmed", text: "Keep this id" });
  sockets[0].frame({ type: "typing", agentId: "a", active: true });
  await client.interrupt("a");
  t.mock.timers.tick(20);
  assert.equal(sockets[0].sent.at(-1)?.type, "ping");
  network.setOnline(false);
  assert.equal(client.getConnectionState(), "error");
  assert.equal(sockets[0].readyState, 3);
  const count = events.length;
  t.mock.timers.tick(60_000);
  assert.equal(events.length, count, "offline requests and heartbeats must not expire again");
  assert.equal(sockets.length, 1);
  await assert.rejects(client.sendMessage({ agentId: "a", text: "Offline draft" }), /Not connected/);
  network.setOnline(true);
  assert.equal(sockets.length, 2);
  sockets[1].open(); sockets[1].ready();
  assert.deepEqual(sockets[1].sent.map((frame) => frame.type), ["hello"]);
  await assert.rejects(client.sendMessage({ agentId: "a", clientMessageId: "unconfirmed", text: "Changed" }), /different text/);
  await client.sendMessage({ agentId: "a", clientMessageId: "unconfirmed", text: "Keep this id" });
  assert.equal(sockets[1].sent.at(-1)?.clientMessageId, "unconfirmed");
  client.disconnect();
  assert.equal(network.listeners.size, 0);
  network.setOnline(false); network.setOnline(true);
  t.mock.timers.tick(60_000);
  assert.equal(sockets.length, 2);
});

test("initial offline state and interrupted backoff wait for a network; access failures stay terminal", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const network = networkHarness(false);
  const { client, sockets } = liveHarness({ network: network.network });
  t.after(() => client.disconnect());
  await client.connect();
  assert.equal(client.getConnectionState(), "error");
  assert.equal(network.listeners.size, 1);
  t.mock.timers.tick(60_000);
  assert.equal(sockets.length, 0);
  network.setOnline(true);
  sockets[0].open(); sockets[0].ready(); sockets[0].remoteClose(1006);
  network.setOnline(false);
  t.mock.timers.tick(60_000);
  assert.equal(sockets.length, 1, "an existing backoff must be cancelled offline");
  network.setOnline(true);
  sockets[1].open(); sockets[1].onerror?.();
  network.setOnline(false);
  t.mock.timers.tick(999);
  sockets[1].remoteClose(4401);
  assert.equal(network.listeners.size, 0);
  network.setOnline(false); network.setOnline(true);
  t.mock.timers.tick(60_000);
  assert.equal(sockets.length, 2, "online events must not retry revoked credentials");
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
  await assert.rejects(client.sendMessage({ agentId: "a", text: "different", clientMessageId: "local2" }), /different text/);
  await client.sendMessage({ agentId: "a", text: "next", clientMessageId: "local2" });
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

test("server cards may contain headerless tables, and empty table decoration is omitted", () => {
  const frame = { type: "chat_reply", agentId: "a", messageId: "card", createdAt: 1 };
  const decoded = decodeServerFrame(JSON.stringify({ ...frame, payload: { kind: "card", card: {
    table: { headers: [], rows: [["Task", "Done"], ["Notes"]] },
  } } }));
  assert.equal(decoded?.type, "chat_reply");
  if (decoded?.type === "chat_reply") assert.deepEqual(decoded.message.card?.table?.headers, []);
  const emptyTable = decodeServerFrame(JSON.stringify({ ...frame, payload: { card: { title: "Summary", table: { headers: [], rows: [] } } } }));
  if (emptyTable?.type === "chat_reply") assert.equal(emptyTable.message.card?.table, undefined);
  assert.throws(() => decodeServerFrame(JSON.stringify({ ...frame, payload: { card: { table: { headers: [], rows: [] } } } })));
});

test("interrupt waits once, preserves v1 refusals, times out, and accepts a later terminal event", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { client, sockets, events } = liveHarness({ interruptTimeoutMs: 100 });
  t.after(() => client.disconnect());
  await client.connect(); const socket = sockets[0]; socket.open(); socket.ready();
  socket.frame({ type: "typing", agentId: "a", active: true });
  socket.frame({ type: "chat_reply", agentId: "a", messageId: "stream", createdAt: 1, streaming: true, payload: {} });
  await client.interrupt("a");
  await client.interrupt("a");
  assert.equal(socket.sent.filter((frame) => frame.type === "interrupt").length, 1);
  assert.deepEqual(events.at(-1), { type: "interrupt_pending", agentId: "a", pending: true });
  socket.frame({ type: "error", agentId: "a", message: "Cannot stop this task" });
  assert.equal((events.at(-1) as { turnEnded?: boolean }).turnEnded, false);
  socket.frame({ type: "message_delta", agentId: "a", messageId: "stream", delta: "still running" });
  assert.equal(events.at(-1)?.type, "message_delta");
  await client.interrupt("a");
  t.mock.timers.tick(100);
  assert.match(JSON.stringify(events.at(-1)), /Stopping was not confirmed/);
  assert.equal((events.at(-1) as { turnEnded?: boolean }).turnEnded, false);
  // Even a refusal that arrives after the timeout must not end the stream.
  socket.frame({ type: "error", agentId: "a", message: "Late refusal" });
  assert.equal((events.at(-1) as { turnEnded?: boolean }).turnEnded, false);
  await client.interrupt("a");
  socket.frame({ type: "typing", agentId: "a", active: false });
  const count = events.length;
  t.mock.timers.tick(1000);
  socket.frame({ type: "message_delta", agentId: "a", messageId: "stream", delta: "late" });
  assert.equal(events.length, count);
});

test("disconnect and roster revocation cancel interrupt timers; explicit turn errors still end output", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { client, sockets, events } = liveHarness({ interruptTimeoutMs: 100 });
  t.after(() => client.disconnect());
  await client.connect(); const socket = sockets[0]; socket.open(); socket.ready();
  await client.interrupt("a");
  socket.frame({ type: "agents", agents: [agents[1]] });
  let count = events.length;
  t.mock.timers.tick(100);
  assert.equal(events.length, count);
  await client.interrupt("b");
  socket.frame({ type: "chat_reply", agentId: "b", messageId: "stream", createdAt: 1, streaming: true, payload: {} });
  socket.frame({ type: "error", agentId: "b", turnEnded: true, message: "Run failed" });
  count = events.length;
  socket.frame({ type: "message_delta", agentId: "b", messageId: "stream", delta: "late" });
  t.mock.timers.tick(100);
  assert.equal(events.length, count);
  await client.interrupt("b");
  client.disconnect();
  count = events.length;
  t.mock.timers.tick(1000);
  assert.equal(events.length, count);
});

test("tool starts remain terminal through repeated results, turn endings and offline rosters", async (t) => {
  const { client, sockets, events } = liveHarness(); t.after(() => client.disconnect());
  await client.connect(); const socket = sockets[0]; socket.open(); socket.ready();
  const activity = { type: "tool_activity", agentId: "a", message: { id: "tool", agentId: "a", role: "assistant", kind: "activity", createdAt: 1, tool: { name: "search" } } };
  socket.frame(activity);
  socket.frame({ ...activity, message: { ...activity.message, tool: { name: "search", ok: true } } });
  let count = events.length;
  socket.frame(activity);
  assert.equal(events.length, count);
  const second = { ...activity, message: { ...activity.message, id: "second" } };
  socket.frame(second);
  socket.frame({ type: "typing", agentId: "a", active: false });
  count = events.length;
  socket.frame(second);
  assert.equal(events.length, count);
  const third = { ...activity, message: { ...activity.message, id: "third" } };
  socket.frame(third);
  socket.frame({ type: "agents", agents: [{ ...agents[0], status: "offline" }] });
  socket.frame({ type: "agents", agents });
  count = events.length;
  socket.frame(third);
  assert.equal(events.length, count);
});

test("idempotency survives reconnect, mismatched receipts, late rejection and history replay", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { client, sockets, events } = liveHarness({ acknowledgementTimeoutMs: 100 });
  t.after(() => client.disconnect());
  await client.connect(); sockets[0].open(); sockets[0].ready();
  const input = { agentId: "a", clientMessageId: "user", text: "Original" };
  const echo = { type: "message", message: { id: "server", clientMessageId: "user", agentId: "a", role: "user", kind: "text", text: "Original", createdAt: 1 } };
  await client.sendMessage(input);
  sockets[0].frame({ ...echo, message: { ...echo.message, text: "Different" } });
  assert.equal(events.some((event) => event.type === "message"), false);
  t.mock.timers.tick(100);
  sockets[0].frame({ type: "error", agentId: "a", clientMessageId: "user", message: "Delayed rejection" });
  assert.match(JSON.stringify(events.at(-1)), /Delayed rejection/);
  sockets[0].remoteClose(1006);
  t.mock.timers.tick(1000);
  const socket = sockets[1]; socket.open(); socket.ready();
  await assert.rejects(client.sendMessage({ ...input, text: "Changed on retry" }), /different text/);
  socket.frame(echo);
  await client.sendMessage(input);
  assert.equal(socket.sent.filter((frame) => frame.type === "send").length, 0, "an acknowledged retry reuses the stored receipt");
  const count = events.length;
  socket.frame({ type: "error", agentId: "a", clientMessageId: "user", message: "Stale rejection" });
  t.mock.timers.tick(100);
  assert.equal(events.length, count);
});

test("disconnecting from a Stop progress listener cannot send on a replacement socket or restart retries", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { client, sockets, events } = liveHarness({ interruptTimeoutMs: 100 });
  t.after(() => client.disconnect());
  await client.connect(); sockets[0].open(); sockets[0].ready();
  client.subscribe((event) => {
    if (event.type === "interrupt_pending" && event.pending) client.disconnect();
  });
  await assert.rejects(client.interrupt("a"), /disconnected/);
  assert.equal(client.getConnectionState(), "disconnected");
  const count = events.length;
  t.mock.timers.tick(60_000);
  assert.equal(events.length, count);
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].sent.some((frame) => frame.type === "interrupt"), false);
});

test("a late v1 interrupt refusal cannot end the next turn", async (t) => {
  const { client, sockets, events } = liveHarness(); t.after(() => client.disconnect());
  await client.connect(); const socket = sockets[0]; socket.open(); socket.ready();
  socket.frame({ type: "typing", agentId: "a", active: true });
  await client.interrupt("a");
  // The old turn can finish naturally before the queued interrupt is rejected.
  socket.frame({ type: "typing", agentId: "a", active: false });
  socket.frame({ type: "typing", agentId: "a", active: true });
  socket.frame({ type: "chat_reply", agentId: "a", messageId: "next", createdAt: 2, streaming: true, payload: {} });
  socket.frame({ type: "error", agentId: "a", message: "The earlier stop request was refused" });
  assert.equal((events.at(-1) as { turnEnded?: boolean }).turnEnded, false);
  socket.frame({ type: "message_delta", agentId: "a", messageId: "next", delta: "New reply continues" });
  assert.equal(events.at(-1)?.type, "message_delta");
  socket.frame({ type: "error", agentId: "a", message: "Explicit run failure", turnEnded: true });
  const count = events.length;
  socket.frame({ type: "message_delta", agentId: "a", messageId: "next", delta: "discarded" });
  assert.equal(events.length, count);
});

test("delivery acknowledgement timeouts are operational errors even before the first reply", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { client, sockets, events } = liveHarness({ acknowledgementTimeoutMs: 100 });
  t.after(() => client.disconnect());
  await client.connect(); const socket = sockets[0]; socket.open(); socket.ready();
  await client.sendMessage({ agentId: "a", text: "Working without a receipt", clientMessageId: "user" });
  socket.frame({ type: "typing", agentId: "a", active: true });
  t.mock.timers.tick(100);
  assert.equal(events.at(-1)?.type, "error");
  assert.equal((events.at(-1) as { turnEnded?: boolean }).turnEnded, false);
});

test("socket errors near handshake and pong deadlines still preserve the authorization close", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  for (const phase of ["handshake", "heartbeat"] as const) {
    const { client, sockets, events } = liveHarness({ handshakeTimeoutMs: 100, heartbeatMs: 20, pongTimeoutMs: 10 });
    t.after(() => client.disconnect());
    await client.connect(); const socket = sockets[0]; socket.open();
    if (phase === "handshake") t.mock.timers.tick(99);
    else { socket.ready(); t.mock.timers.tick(20); t.mock.timers.tick(9); }
    socket.onerror?.();
    t.mock.timers.tick(1);
    socket.remoteClose(4401);
    t.mock.timers.tick(2000);
    assert.equal(sockets.length, 1, `${phase} timeout must not swallow the policy close`);
    assert.match(JSON.stringify(events.at(-1)), /Authentication failed/);
    client.disconnect();
  }
});

test("the frame limit counts UTF-8 bytes, including CJK and surrogate pairs", () => {
  const frame = (text: string) => JSON.stringify({ type: "error", message: text });
  for (const text of ["x".repeat(999_960), "汉".repeat(330_000), "😀".repeat(240_000)]) {
    const raw = frame(text);
    assert.ok(Buffer.byteLength(raw) <= 1_000_000);
    assert.equal(decodeServerFrame(raw)?.type, "error");
  }
  for (const text of ["x".repeat(1_000_000), "汉".repeat(340_000), "😀".repeat(250_000)]) {
    const raw = frame(text);
    assert.ok(Buffer.byteLength(raw) > 1_000_000);
    assert.throws(() => decodeServerFrame(raw));
  }
});

test("empty card decoration cannot hide a usable chat_reply", () => {
  const frame = { type: "chat_reply", agentId: "a", messageId: "reply", createdAt: 1 };
  // RemoteChannelSessionHandle cards may contain only blank fields or rows.
  for (const decoration of [{}, { title: " \n " }, { fields: [{ label: "", value: " " }] }, { table: { headers: [], rows: [[]] } }]) {
    for (const content of [{ text: "A visible reply" }, { attachments: [{ url: "https://example.com/report.pdf" }] }]) {
      const decoded = decodeServerFrame(JSON.stringify({ ...frame, payload: { ...content, kind: "card", card: decoration } }));
      assert.equal(decoded?.type, "chat_reply");
      if (decoded?.type === "chat_reply") {
        assert.equal(decoded.message.card, undefined);
        assert.ok(decoded.message.text || decoded.message.attachments?.length);
      }
    }
    assert.throws(() => decodeServerFrame(JSON.stringify({ ...frame, payload: { card: decoration } })), "a wholly blank reply is still invalid");
  }
  for (const card of [null, [], { fields: [{ label: 1, value: "" }] }, { imageUrl: "file:///secret" }]) {
    assert.throws(() => decodeServerFrame(JSON.stringify({ ...frame, payload: { text: "Visible", card } })));
  }
  assert.throws(() => decodeServerFrame(JSON.stringify({ ...frame, payload: { text: "Visible", kind: "card" } })));
});

test("an idle roster confirms Stop after a busy handshake snapshot without a false timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { client, sockets, events } = liveHarness({ interruptTimeoutMs: 100 });
  t.after(() => client.disconnect());
  await client.connect(); sockets[0].open(); sockets[0].ready();
  sockets[0].frame({ type: "typing", agentId: "a", active: true });
  sockets[0].remoteClose(1006);
  t.mock.timers.tick(1000);
  const socket = sockets[1]; socket.open();
  socket.frame({ type: "ready", protocol: 1, agents: agents.map((agent) => ({ ...agent, status: "busy" })) });
  await client.interrupt("a");
  // The turn ended between the ready snapshot and the new socket subscription.
  socket.frame({ type: "agents", agents });
  assert.deepEqual(events.filter((event) => event.type === "interrupt_pending"), [
    { type: "interrupt_pending", agentId: "a", pending: true },
    { type: "interrupt_pending", agentId: "a", pending: false },
  ]);
  t.mock.timers.tick(100);
  assert.equal(events.some((event) => event.type === "error"), false);
  socket.frame({ type: "typing", agentId: "a", active: true });
  await client.interrupt("a");
  assert.equal(socket.sent.filter((frame) => frame.type === "interrupt").length, 2);
});

test("idle rosters cannot confirm Stop over explicit live typing, streams or tools", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const signals = [
    { type: "typing", agentId: "a", active: true },
    { type: "chat_reply", agentId: "a", messageId: "stream", createdAt: 1, streaming: true, payload: {} },
    { type: "tool_activity", agentId: "a", message: { id: "tool", agentId: "a", role: "assistant", kind: "activity", createdAt: 1, tool: { name: "chat_reply" } } },
  ];
  for (const signal of signals) {
    const { client, sockets, events } = liveHarness({ interruptTimeoutMs: 100 });
    t.after(() => client.disconnect());
    await client.connect(); const socket = sockets[0]; socket.open(); socket.ready();
    socket.frame(signal);
    await client.interrupt("a");
    socket.frame({ type: "agents", agents });
    await client.interrupt("a");
    assert.equal(socket.sent.filter((frame) => frame.type === "interrupt").length, 1, signal.type);
    assert.equal(events.filter((event) => event.type === "interrupt_pending").length, 1, signal.type);
    socket.frame({ type: "typing", agentId: "a", active: false });
    t.mock.timers.tick(100);
    assert.equal(events.some((event) => event.type === "error"), false, signal.type);
    client.disconnect();
  }
});

test("remapped receipt aliases retain their body and client id through reconnect replay", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { client, sockets, events } = liveHarness({ acknowledgementTimeoutMs: 100 });
  t.after(() => client.disconnect());
  await client.connect(); sockets[0].open(); sockets[0].ready();
  const input = { agentId: "a", clientMessageId: "local", text: "Original body" };
  const message = { id: "server", clientMessageId: "local", agentId: "a", role: "user", kind: "text", text: input.text, createdAt: 1 };
  await client.sendMessage(input);
  sockets[0].frame({ type: "message", message });
  sockets[0].remoteClose(1006);
  t.mock.timers.tick(1000);
  const socket = sockets[1]; socket.open(); socket.ready();

  socket.frame({ type: "message", message: { ...message, clientMessageId: undefined, text: "Changed replay body" } });
  assert.equal(events.filter((event) => event.type === "message").length, 1, "a server-id replay must not bypass receipt validation");
  assert.match(JSON.stringify(events.at(-1)), /different text/);
  socket.frame({ type: "message", message: { ...message, clientMessageId: undefined } });
  const replay = events.at(-1);
  assert.equal(replay?.type, "message");
  if (replay?.type === "message") assert.equal(replay.message.clientMessageId, "local");
  const count = events.length;
  socket.frame({ type: "error", agentId: "a", clientMessageId: "local", message: "Late rejection" });
  t.mock.timers.tick(100);
  assert.equal(events.length, count);
  await client.sendMessage(input);
  assert.equal(socket.sent.some((frame) => frame.type === "send"), false, "a confirmed retry only reuses its original receipt");
  assert.equal(client.getConnectionState(), "connected");
});

test("receipt ids cannot be reassigned and aliases are scoped to roster access", async (t) => {
  const { client, sockets, events } = liveHarness();
  t.after(() => client.disconnect());
  await client.connect(); const socket = sockets[0]; socket.open(); socket.ready();
  const message = { id: "server", clientMessageId: "local", agentId: "a", role: "user", kind: "text", text: "Original", createdAt: 1 };
  socket.frame({ type: "message", message });
  for (const changed of [{ ...message, clientMessageId: "other" }, { ...message, id: "another-server-id" }]) {
    socket.frame({ type: "message", message: changed });
    assert.equal(events.filter((event) => event.type === "message").length, 1);
    assert.match(JSON.stringify(events.at(-1)), /conflicting ids/);
  }
  await assert.rejects(client.sendMessage({ agentId: "a", clientMessageId: "server", text: "Original" }), /already used/);
  socket.frame({ type: "message", message: { ...message, agentId: "b", text: "Other agent's message" } });
  assert.equal(events.filter((event) => event.type === "message").length, 2, "message ids belong to a conversation");
  socket.frame({ type: "agents", agents: [agents[1]] });
  socket.frame({ type: "agents", agents });
  socket.frame({ type: "message", message: { ...message, clientMessageId: "new-local", text: "New access" } });
  assert.equal(events.filter((event) => event.type === "message").length, 3, "revocation drops the old receipt aliases");
});

test("socket errors cancel delivery and interrupt deadlines while awaiting the close code", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { client, sockets, events } = liveHarness({ acknowledgementTimeoutMs: 100, interruptTimeoutMs: 100 });
  t.after(() => client.disconnect());
  await client.connect(); const socket = sockets[0]; socket.open(); socket.ready();
  await client.sendMessage({ agentId: "a", clientMessageId: "pending", text: "Keep this message" });
  socket.frame({ type: "typing", agentId: "b", active: true });
  await client.interrupt("b");
  t.mock.timers.tick(99);
  socket.onerror?.();
  const count = events.length;
  t.mock.timers.tick(500);
  assert.equal(events.length, count, "settled operations must not emit timeouts during the close grace period");
  socket.remoteClose(4401);
  t.mock.timers.tick(5000);
  assert.equal(sockets.length, 1, "the authentication close remains terminal");
  assert.match(JSON.stringify(events.at(-1)), /Authentication failed/);
});
