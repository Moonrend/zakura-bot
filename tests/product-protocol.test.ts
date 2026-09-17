import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeServerFrame } from "../lib/channel/protocol.js";

test("roster carries authorized binding identity, profile and product capabilities", () => {
  const row = { id: "bot", name: "Research", bindingId: "binding-1", description: "Research assistant", status: "idle",
    capabilities: { files: true, desktop: false, interactions: true } };
  const frame = decodeServerFrame(JSON.stringify({ type: "ready", protocol: 1, agents: [row] }));
  assert.equal(frame?.type, "ready");
  if (frame?.type !== "ready") return;
  assert.equal(frame.agents[0]!.bindingId, "binding-1");
  assert.equal(frame.agents[0]!.description, "Research assistant");
  assert.deepEqual(frame.agents[0]!.capabilities, row.capabilities);
  assert.throws(() => decodeServerFrame(JSON.stringify({ type: "agents", agents: [{ ...row, bindingId: "__proto__" }] })));
});
