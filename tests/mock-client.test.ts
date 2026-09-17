import assert from "node:assert/strict";
import { test } from "node:test";
import { MockZakuraChannelClient } from "../lib/channel/mock-client";
import type { ChannelEvent } from "../lib/channel/types";

test("disconnect during mock connect cannot later resurrect the connection", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = new MockZakuraChannelClient();
  const events: ChannelEvent[] = []; client.subscribe((event) => events.push(event));
  const pending = client.connect();
  client.disconnect();
  t.mock.timers.tick(250); await pending;
  assert.equal(client.getConnectionState(), "disconnected");
  assert.equal(events.some((event) => event.type === "connection" && event.state === "connected"), false);
});

test("disconnecting from a mock roster listener cannot publish readiness", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = new MockZakuraChannelClient();
  const events: ChannelEvent[] = [];
  client.subscribe((event) => {
    events.push(event);
    if (event.type === "agents") client.disconnect();
  });
  const pending = client.connect();
  t.mock.timers.tick(250); await pending;
  assert.equal(client.getConnectionState(), "disconnected");
  assert.equal(events.some((event) => event.type === "connection" && event.state === "connected"), false);
  await assert.rejects(client.sendMessage({ agentId: "agent_zakura", text: "Keep this draft" }), /Not connected/);
});

test("mock connection notifications cannot overwrite a replacement handshake", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const phase of ["connecting", "agents", "connected"] as const) {
    const client = new MockZakuraChannelClient();
    t.after(() => client.disconnect());
    const events: ChannelEvent[] = [];
    let replacement: Promise<void> | undefined;
    let replaced = false;
    client.subscribe((event) => {
      events.push(event);
      if (replaced || (phase === "agents" ? event.type !== "agents" : event.type !== "connection" || event.state !== phase)) return;
      replaced = true;
      client.disconnect();
      replacement = client.connect();
    });
    const initial = client.connect();
    t.mock.timers.tick(250); await initial;
    const sameAttempt = client.connect();
    assert.equal(events.filter((event) => event.type === "connection" && event.state === "connecting").length, 2, phase);
    t.mock.timers.tick(250); await replacement; await sameAttempt;
    assert.equal(client.getConnectionState(), "connected", phase);
    assert.equal(events.filter((event) => event.type === "connection" && event.state === "connected").length,
      phase === "connected" ? 2 : 1, "only current handshakes can become ready");
    client.disconnect();
  }
});

test("mock retries reuse their receipt without restarting a turn, including after reconnect", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = new MockZakuraChannelClient();
  t.after(() => client.disconnect());
  const events: ChannelEvent[] = [];
  client.subscribe((event) => events.push(event));
  const pending = client.connect(); t.mock.timers.tick(250); await pending;
  const input = { agentId: "agent_zakura", text: "hello", clientMessageId: "stable" };
  await client.sendMessage(input);
  const receipt = events.find((event) => event.type === "message");
  assert.ok(receipt);
  events.length = 0;
  await client.sendMessage(input);
  assert.deepEqual([...events], [receipt], "retrying an accepted id only repeats its stored receipt");
  await assert.rejects(client.sendMessage({ ...input, text: "different text" }), /different text/);
  await client.interrupt(input.agentId);
  events.length = 0;
  await client.sendMessage(input);
  assert.deepEqual([...events], [receipt], "retrying cannot restart a stopped turn");
  client.disconnect();
  const reconnecting = client.connect(); t.mock.timers.tick(250); await reconnecting;
  events.length = 0;
  await client.sendMessage(input);
  assert.deepEqual([...events], [receipt], "manual reconnect retains the same receipt and timestamp");
  await client.sendMessage({ ...input, agentId: "agent_research", text: "A separate conversation" });
  assert.ok(events.some((event) => event.type === "typing" && event.agentId === "agent_research" && event.active));
});

test("mock sends validate ids and trimmed text like the live channel", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = new MockZakuraChannelClient();
  t.after(() => client.disconnect());
  const events: ChannelEvent[] = [];
  client.subscribe((event) => events.push(event));
  const pending = client.connect(); t.mock.timers.tick(250); await pending;
  for (const clientMessageId of ["", "__proto__", "bad\nid"]) {
    await assert.rejects(client.sendMessage({ agentId: "agent_zakura", text: "hello", clientMessageId }), /message id/);
  }
  await client.sendMessage({ agentId: "agent_zakura", clientMessageId: "trimmed", text: ` ${"a".repeat(4000)} ` });
  const receipt = events.find((event) => event.type === "message");
  assert.equal(receipt?.type === "message" ? receipt.message.text : undefined, "a".repeat(4000));
  await assert.rejects(client.sendMessage({ agentId: "agent_zakura", text: "a".repeat(4001) }), /too long/);
});

test("a mock receipt listener can disconnect without starting output on the replacement connection", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = new MockZakuraChannelClient();
  t.after(() => client.disconnect());
  const events: ChannelEvent[] = [];
  client.subscribe((event) => events.push(event));
  const pending = client.connect(); t.mock.timers.tick(250); await pending;
  let replacement: Promise<void> | undefined;
  const unsubscribe = client.subscribe((event) => {
    if (event.type !== "message") return;
    client.disconnect();
    replacement = client.connect();
  });
  await client.sendMessage({ agentId: "agent_zakura", clientMessageId: "received", text: "hello" });
  unsubscribe();
  t.mock.timers.tick(250); await replacement;
  t.mock.timers.tick(1000); await Promise.resolve();
  assert.equal(client.getConnectionState(), "connected");
  assert.equal(events.some((event) => event.type === "typing" && event.active), false);
  assert.equal(events.some((event) => event.type === "tool_activity"), false);
});

test("stopping a mock turn settles its running tool and emits no later output", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = new MockZakuraChannelClient(); t.after(() => client.disconnect());
  const events: ChannelEvent[] = []; client.subscribe((event) => events.push(event));
  const pending = client.connect(); t.mock.timers.tick(250); await pending;
  await client.sendMessage({ agentId: "agent_zakura", text: "slow", clientMessageId: "u1" });
  t.mock.timers.tick(400); await Promise.resolve();
  assert.ok(events.some((event) => event.type === "tool_activity" && event.message.tool?.ok === undefined));
  await client.interrupt("agent_zakura");
  const count = events.length;
  t.mock.timers.tick(10_000); await Promise.resolve();
  assert.equal(events.length, count);
  assert.ok(events.some((event) => event.type === "tool_activity" && event.message.tool?.interrupted));
  assert.equal(events.at(-1)?.type, "typing");
  await assert.rejects(client.sendMessage({ agentId: "agent_ops", text: "hello" }));
});
