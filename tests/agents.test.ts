import assert from "node:assert/strict";
import { test } from "node:test";
import { agentPath, agentsPath, mePath, parseAccountInfo, parseAgentDetail, parseAgentList } from "../lib/agents.js";

test("agent paths encode ids and never allow traversal through them", () => {
  assert.equal(agentsPath(), "/api/agents");
  assert.equal(agentPath("agent 1/../two"), "/api/agents/agent%201%2F..%2Ftwo");
  assert.equal(mePath(), "/api/me");
});
test("agent payloads fall back safely on missing fields", () => {
  const parsed = parseAgentDetail({ id: "a1", name: "Helper", enableComputer: true });
  assert.deepEqual(parsed, { id: "a1", name: "Helper", slug: "", description: "", enableComputer: true, enableMemory: false });
  assert.equal(parseAgentList([parsed]).length, 1);
  assert.throws(() => parseAgentList({}));
  assert.throws(() => parseAgentDetail(null));
  assert.throws(() => parseAgentDetail({ name: "no id" }));
  assert.throws(() => parseAgentDetail({ id: "a1" }));
});
test("/api/me exposes management by role and never for members", () => {
  assert.deepEqual(parseAccountInfo({ role: "owner", user: { name: "Ada" }, tenant: { name: "Work" } }),
    { canManage: true, tenantName: "Work", userName: "Ada" });
  assert.deepEqual(parseAccountInfo({ role: "admin", user: { email: "a@x" }, tenant: {} }),
    { canManage: true, tenantName: "", userName: "a@x" });
  assert.deepEqual(parseAccountInfo({ role: "member" }), { canManage: false, tenantName: "", userName: "" });
  assert.throws(() => parseAccountInfo({}));
  assert.throws(() => parseAccountInfo(null));
});
