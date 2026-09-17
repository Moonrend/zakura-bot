import assert from "node:assert/strict";
import { test } from "node:test";
import { botGroupKey, emptyGroups, groupedAgents, parseGroups, reduceGroups } from "../lib/groups";
import { agents } from "./helpers";

test("group order and membership survive renaming; deleting returns bots to Ungrouped", () => {
  let state = reduceGroups(emptyGroups(), { type: "create", id: "work", name: " Work " });
  state = reduceGroups(state, { type: "create", id: "personal", name: "Personal" });
  state = reduceGroups(state, { type: "assign", botKey: "a", sectionId: "work" });
  state = reduceGroups(state, { type: "rename", id: "work", name: "Projects" });
  state = reduceGroups(state, { type: "move", id: "personal", direction: -1 });
  assert.deepEqual(groupedAgents(agents, state).map(({ name, agents: members }) => [name, members.map((bot) => bot.id)]),
    [["Personal", []], ["Projects", ["a"]], ["Ungrouped", ["b"]]]);
  assert.deepEqual(parseGroups(JSON.parse(JSON.stringify(state))), state);
  state = reduceGroups(state, { type: "delete", id: "work" });
  assert.deepEqual(state.assignments, {});
  assert.deepEqual(groupedAgents(agents, state).at(-1)?.agents, agents);
});

test("membership follows binding identity and can be removed", () => {
  const bot = { ...agents[0]!, bindingId: "binding" };
  let state = reduceGroups(emptyGroups(), { type: "create", id: "work", name: "Work" });
  state = reduceGroups(state, { type: "assign", botKey: botGroupKey(bot), sectionId: "work" });
  assert.deepEqual(groupedAgents([{ ...bot, id: "replacement" }], state)[0]?.agents.map((row) => row.id), ["replacement"]);
  state = reduceGroups(state, { type: "assign", botKey: botGroupKey(bot), sectionId: null });
  assert.deepEqual(state.assignments, {});
});

test("invalid names, duplicate names and missing destinations do not change saved groups", () => {
  const state = reduceGroups(emptyGroups(), { type: "create", id: "work", name: "Work" });
  for (const name of ["", "  ", "a".repeat(65), "wOrK"]) {
    assert.throws(() => reduceGroups(state, { type: "create", id: "new", name }));
  }
  assert.throws(() => reduceGroups(state, { type: "assign", botKey: "a", sectionId: "missing" }));
  assert.deepEqual(reduceGroups(state, { type: "move", id: "work", direction: -1 }), state);
  assert.equal(state.sections[0]?.name, "Work");
});

test("loading damaged local data preserves valid sections and removes orphaned assignments", () => {
  const state = parseGroups(JSON.parse('{"sections":[null,{"id":"work","name":" Work "},{"id":"work","name":"Duplicate"},{"id":"__proto__","name":"Invalid"}],"assignments":{"a":"work","b":"gone","__proto__":"work"}}'));
  assert.deepEqual(state, { sections: [{ id: "work", name: "Work" }], assignments: { a: "work" } });
  assert.deepEqual(parseGroups(null), emptyGroups());
});
