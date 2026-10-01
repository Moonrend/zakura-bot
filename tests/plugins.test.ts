import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildInstallBody,
  connectionActionPath,
  connectionPath,
  installedRowState,
  listingComponents,
  parseInstallResult,
  parseInstalled,
  parseSearchResults,
  pluginKindLabel,
  pluginListingRow,
  pluginSearchPath,
  type InstalledPlugin,
  type PluginListing,
} from "../lib/plugins.js";

function listing(overrides: Partial<PluginListing> = {}): PluginListing {
  return {
    id: "mcp:store:Fetch",
    name: "Fetch",
    description: "Fetch a URL.",
    kind: "mcp-http",
    source: "store",
    installRef: "mcp:store:Fetch",
    bundledSkills: [],
    bundledHookEvents: [],
    ...overrides,
  };
}

test("marketplace search keeps valid listings and drops malformed rows", () => {
  const parsed = parseSearchResults({ total: 3, items: [
    { id: "skill:1", name: "Summarize", description: "Shorten text.", kind: "skill", source: "skill-curated", installRef: "builtin:summarize" },
    { name: "missing id" },
    { id: "no-name" },
  ] });
  assert.equal(parsed.total, 3);
  assert.equal(parsed.items.length, 1);
  assert.deepEqual(parsed.items[0], {
    id: "skill:1", name: "Summarize", description: "Shorten text.", kind: "skill",
    source: "skill-curated", installRef: "builtin:summarize", bundledSkills: [], bundledHookEvents: [],
  });
});

test("marketplace search tolerates a bare array and falls back to the item count", () => {
  const parsed = parseSearchResults([{ id: "a", name: "A" }]);
  assert.equal(parsed.total, 1);
  assert.equal(parsed.items[0]?.installRef, "a");
  assert.deepEqual(parseSearchResults({}), { total: 0, items: [] });
  assert.deepEqual(parseSearchResults(null), { total: 0, items: [] });
});

test("search and connection paths encode their identifiers", () => {
  assert.equal(pluginSearchPath("  a b  "), "/api/connections/search?q=a%20b");
  assert.equal(pluginSearchPath(""), "/api/connections/search?q=");
  assert.equal(connectionPath("instance:abc"), "/api/connections/instance%3Aabc");
  assert.equal(connectionActionPath("instance:abc", "start"), "/api/connections/instance%3Aabc/start");
});

test("kinds map to plain labels and bundled components fold into the row view model", () => {
  assert.equal(pluginKindLabel("mcp-stdio"), "MCP server");
  assert.equal(pluginKindLabel("plugin"), "Plugin");
  const row = pluginListingRow(listing({ kind: "plugin", bundledSkills: [{ name: "Review", source: "s" }],
    bundledHookEvents: ["PostToolUse"] }));
  assert.equal(row.kindLabel, "Plugin");
  assert.deepEqual(row.components, [{ name: "Review", kindLabel: "Skill" }, { name: "PostToolUse", kindLabel: "Hook" }]);
  assert.deepEqual(listingComponents(listing()), []);
});

test("install payload sends the listing's install ref and kind", () => {
  assert.deepEqual(buildInstallBody(listing({ installRef: "curated:linear", kind: "mcp-http" })),
    { source: "curated:linear", kind: "mcp-http" });
});

test("installed parsing rejects non-list payloads but drops individual bad rows", () => {
  assert.throws(() => parseInstalled({}), /invalid plugin information/);
  assert.throws(() => parseInstalled(null), /invalid plugin information/);
  const parsed = parseInstalled({ items: [
    { id: "instance:1", name: "Linear", kind: "mcp-http", status: "running", agentIds: ["a1", 7] },
    { id: "skill:2", name: "Summarize", kind: "skill", status: "installed" },
    { name: "no id" },
  ] });
  assert.deepEqual(parsed, [
    { id: "instance:1", name: "Linear", kind: "mcp-http", status: "running", agentIds: ["a1"] },
    { id: "skill:2", name: "Summarize", kind: "skill", status: "installed", agentIds: [] },
  ]);
});

function installed(overrides: Partial<InstalledPlugin>): InstalledPlugin {
  return { id: "instance:1", name: "Linear", kind: "mcp-http", status: "running", agentIds: [], ...overrides };
}

test("installed rows derive status text, tone and start/stop actions", () => {
  const running = installedRowState(installed({ status: "running" }));
  assert.equal(running.statusLabel, "Running");
  assert.equal(running.tone, "success");
  assert.deepEqual([running.canStart, running.canStop], [false, true]);

  const stopped = installedRowState(installed({ status: "stopped" }));
  assert.equal(stopped.statusLabel, "Stopped");
  assert.equal(stopped.tone, "muted");
  assert.deepEqual([stopped.canStart, stopped.canStop], [true, false]);

  const failed = installedRowState(installed({ status: "error" }));
  assert.equal(failed.tone, "danger");
  assert.deepEqual([failed.canStart, failed.canStop], [true, false]);

  const starting = installedRowState(installed({ status: "starting" }));
  assert.equal(starting.statusLabel, "Starting");
  assert.deepEqual([starting.canStart, starting.canStop], [false, true]);
});

test("skills are never startable and expose their install state", () => {
  const skill = installedRowState(installed({ id: "skill:2", kind: "skill", status: "installed" }));
  assert.equal(skill.isInstance, false);
  assert.equal(skill.statusLabel, "Installed");
  assert.equal(skill.tone, "success");
  assert.deepEqual([skill.canStart, skill.canStop], [false, false]);
  assert.equal(installedRowState(installed({ id: "skill:2", kind: "skill", status: "error" })).tone, "danger");
  const unknown = installedRowState(installed({ status: "weird" }));
  assert.equal(unknown.statusLabel, "weird");
  assert.equal(unknown.tone, "muted");
});

test("install results surface per-component failures, including nested bundles", () => {
  const parsed = parseInstallResult({ result: { id: "plugin:x", kind: "plugin", name: "Alpha", status: "installed",
    bundled: [
      { name: "Skill one", kind: "skill", status: "installed" },
      { name: "Server two", kind: "mcp-http", status: "error: connection refused" },
      { name: "Wrapper", kind: "plugin", status: "installed", bundled: [{ name: "Nested", kind: "skill", status: "error:" }] },
    ] } });
  assert.equal(parsed.name, "Alpha");
  assert.equal(parsed.components.length, 4);
  assert.deepEqual(parsed.components.filter((component) => component.error).map((component) => [component.name, component.error]),
    [["Server two", "connection refused"], ["Nested", "Install failed"]]);
});

test("install results require a confirmable payload", () => {
  assert.throws(() => parseInstallResult({}), /did not confirm the install/);
  assert.throws(() => parseInstallResult({ result: { id: "x" } }), /did not confirm the install/);
  assert.deepEqual(parseInstallResult({ result: { id: "x", kind: "skill", name: "Solo", status: "installed" } }),
    { name: "Solo", status: "installed", components: [] });
});
