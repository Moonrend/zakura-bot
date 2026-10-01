import assert from "node:assert/strict";
import { test } from "node:test";
import { commandEntries, matchRank, rankCommandEntries, MESSAGE_RESULT_LIMIT } from "../lib/command-palette";
import type { Agent, ChatMessage } from "../lib/types";

const agent = (id: string, name: string, extra: Partial<Agent> = {}): Agent =>
  ({ id, name, color: "#fff", status: "idle", unread: false, ...extra });

const message = (id: string, agentId: string, text: string, createdAt: number): ChatMessage =>
  ({ id, agentId, role: "assistant", kind: "text", text, createdAt });

const pad = (value: number) => String(value).padStart(2, "0");

test("empty query lists agents first, then settings, and never messages", () => {
  const agents = [agent("a1", "Research"), agent("a2", "Ops")];
  const messages = { a1: [message("m1", "a1", "a hidden transcript line", 1)] };
  const result = rankCommandEntries(commandEntries(agents, messages), "");
  assert.deepEqual(result.map((entry) => entry.label), ["Research", "Ops", "Go to settings", "New agent", "Sign out"]);
  assert.equal(result.some((entry) => entry.kind === "message"), false);
});

test("agents match on name and description and rank prefix above substring", () => {
  const agents = [agent("a1", "My Report", { description: "Weekly numbers" }), agent("a2", "Report"), agent("a3", "Ops", { title: "Deployment helper" })];
  const result = rankCommandEntries(commandEntries(agents, {}), "report");
  assert.deepEqual(result.filter((entry) => entry.kind === "agent").map((entry) => entry.label), ["Report", "My Report"]);
  const deploy = rankCommandEntries(commandEntries(agents, {}), "deploy");
  assert.deepEqual(deploy.filter((entry) => entry.kind === "agent").map((entry) => entry.label), ["Ops"]);
});

test("agents match a subsequence and ignore case", () => {
  assert.notEqual(matchRank("rsh", "Research"), null);
  assert.notEqual(matchRank("RESEARCH", "Research"), null);
  const agents = [agent("a1", "Research")];
  assert.deepEqual(rankCommandEntries(commandEntries(agents, {}), "rsh").map((entry) => entry.label), ["Research"]);
});

test("messages match on text only, newest first, and carry the agent name", () => {
  const agents = [agent("a1", "Alpha")];
  const messages = { a1: [
    message("m1", "a1", "note 01 needle", 1),
    message("m2", "a1", "note 02 needle", 2),
    message("m3", "a1", "note 03 needle", 3),
  ] };
  const result = rankCommandEntries(commandEntries(agents, messages), "needle");
  assert.deepEqual(result.map((entry) => entry.label), ["note 03 needle", "note 02 needle", "note 01 needle"]);
  assert.equal(result.every((entry) => entry.kind === "message" && entry.detail === "Alpha"), true);
  // The agent name is not part of a message's match text.
  assert.equal(rankCommandEntries(commandEntries(agents, messages), "Alpha").some((entry) => entry.kind === "message"), false);
});

test("message results are capped at the newest matches", () => {
  const agents = [agent("a1", "Alpha")];
  const list: ChatMessage[] = [];
  for (let index = 1; index <= 25; index++) list.push(message(`m${index}`, "a1", `note ${pad(index)} needle`, index));
  const result = rankCommandEntries(commandEntries(agents, { a1: list }), "needle");
  assert.equal(result.length, MESSAGE_RESULT_LIMIT);
  assert.equal(result[0]!.label, "note 25 needle");
  assert.equal(result[MESSAGE_RESULT_LIMIT - 1]!.label, "note 06 needle");
});

test("settings entries are fixed and searchable", () => {
  const entries = commandEntries([], {});
  assert.deepEqual(entries.map((entry) => entry.label), ["Go to settings", "New agent", "Sign out"]);
  assert.deepEqual(entries.map((entry) => entry.group), ["Settings", "Settings", "Settings"]);
  assert.deepEqual(rankCommandEntries(entries, "sign").map((entry) => entry.label), ["Sign out"]);
  // Prefix beats the looser subsequence match ("Sign out" contains g…o).
  assert.equal(rankCommandEntries(entries, "go")[0]!.label, "Go to settings");
});

test("matchRank accepts empty queries and rejects misses", () => {
  assert.equal(matchRank("", "anything"), 0);
  assert.equal(matchRank("   ", "anything"), 0);
  assert.equal(matchRank("zzz", "Research"), null);
  assert.equal(matchRank("x", ""), null);
  assert.ok(matchRank("sea", "Research")! > matchRank("rsh", "Research")!);
});
