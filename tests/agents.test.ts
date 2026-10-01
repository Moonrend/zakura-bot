import assert from "node:assert/strict";
import { test } from "node:test";
import { agentNameError, agentPath, agentsPath, defaultSpaceId, filterAgentsBySpace, groupAgentsBySpace, mePath, parseAccountInfo,
  parseAgentDetail, parseAgentList, parseSpaceList, resolveSpaceId } from "../lib/agents.js";

test("agent paths encode ids and never allow traversal through them", () => {
  assert.equal(agentsPath(), "/api/agents");
  assert.equal(agentPath("agent 1/../two"), "/api/agents/agent%201%2F..%2Ftwo");
  assert.equal(mePath(), "/api/me");
});
test("agent payloads fall back safely on missing fields", () => {
  const parsed = parseAgentDetail({ id: "a1", name: "Helper", enableComputer: true });
  assert.deepEqual(parsed, { id: "a1", name: "Helper", slug: "", description: "", enableComputer: true, enableMemory: false, spaceId: null, spaceName: null });
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

test("agent name validation mirrors the server's required, 120-char rule", () => {
  assert.equal(agentNameError("Helper"), null);
  assert.equal(agentNameError("  Helper  "), null);
  assert.equal(agentNameError("   "), "Enter a name for this agent.");
  assert.equal(agentNameError(""), "Enter a name for this agent.");
  assert.equal(agentNameError("x".repeat(120)), null);
  assert.equal(agentNameError("x".repeat(121)), "Names are limited to 120 characters.");
});

test("space listings accept both server shapes and drop malformed rows", () => {
  assert.deepEqual(parseSpaceList({ spaces: [{ id: "s1", name: "Work", slug: "work", agentCount: 2 }] }),
    [{ id: "s1", name: "Work", slug: "work", agentCount: 2 }]);
  assert.deepEqual(parseSpaceList([{ id: "s1", name: "Work" }, { id: 3, name: "bad" }]), 
    [{ id: "s1", name: "Work", slug: "", agentCount: 0 }]);
  assert.deepEqual(parseSpaceList({}), []);
  assert.deepEqual(parseSpaceList(null), []);
});

test("space selection restores a saved space or defaults to the tenant default", () => {
  const spaces = [{ id: "s2", name: "Personal", slug: "personal", agentCount: 0 },
    { id: "s1", name: "Work", slug: "default", agentCount: 3 }];
  assert.equal(defaultSpaceId(spaces), "s1");
  assert.equal(defaultSpaceId([spaces[0]!]), "s2");
  assert.equal(defaultSpaceId([]), null);
  assert.equal(resolveSpaceId(spaces, "s2"), "s2");
  assert.equal(resolveSpaceId(spaces, "gone"), "s1");
  assert.equal(resolveSpaceId(spaces), "s1");
});

test("roster filters by the selected space and keeps space-less agents visible", () => {
  const roster = [
    { id: "a", name: "A", color: "#1084fe", status: "idle" as const, unread: false, spaceId: "s1", spaceName: "Work" },
    { id: "b", name: "B", color: "#38d591", status: "idle" as const, unread: false, spaceId: "s2", spaceName: "Personal" },
  ];
  assert.deepEqual(filterAgentsBySpace(roster, "s1").map((agent) => agent.id), ["a"]);
  assert.deepEqual(filterAgentsBySpace(roster, null).map((agent) => agent.id), ["a", "b"]);
  const legacy = [{ id: "a", name: "A", color: "#1084fe", status: "idle" as const, unread: false }];
  assert.deepEqual(filterAgentsBySpace(legacy, "s1"), legacy);
  assert.deepEqual(groupAgentsBySpace(roster).map(({ name, agents: members }) => [name, members.map((agent) => agent.id)]),
    [["Work", ["a"]], ["Personal", ["b"]]]);
});
