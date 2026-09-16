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
