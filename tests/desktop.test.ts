import assert from "node:assert/strict";
import { test } from "node:test";
import { desktopPath, desktopPhase, parseDesktopInfo, workspaceOffline } from "../lib/desktop";

test("desktop metadata bounds refresh rates and never trusts a remote frame URL", () => {
  const info = parseDesktopInfo({ enabled: true, supported: true, width: 1280, height: 720, suggestedIntervalMs: 1,
    frameUrl: "https://untrusted.example/collect", cdpUrl: "http://private-runner:9222" });
  assert.equal(info.suggestedIntervalMs, 2000);
  assert.equal(JSON.stringify(info).includes("untrusted"), false);
  assert.equal(JSON.stringify(info).includes("private-runner"), false);
  assert.equal(desktopPath("bot/one", true), "/api/zakurabot/agents/bot%2Fone/desktop/frame");
  assert.equal(parseDesktopInfo({ enabled: true, supported: true, suggestedIntervalMs: 999999 }).suggestedIntervalMs, 30000);
  assert.throws(() => parseDesktopInfo({ enabled: true }), /invalid desktop/);
});

test("desktop phase separates off, starting and running workspaces", () => {
  assert.equal(desktopPhase({ status: "idle", hasFrame: false, loading: false }), "off");
  assert.equal(desktopPhase({ status: "unbound", hasFrame: false, loading: false }), "off");
  assert.equal(desktopPhase({ status: "offline", hasFrame: false, loading: false }), "off");
  assert.equal(desktopPhase({ status: "exited", hasFrame: false, loading: false }), "off");
  assert.equal(desktopPhase({ status: "created", hasFrame: false, loading: false }), "starting");
  assert.equal(desktopPhase({ status: "restarting", hasFrame: false, loading: false }), "starting");
  assert.equal(desktopPhase({ status: "idle", hasFrame: false, loading: true }), "starting");
  assert.equal(desktopPhase({ status: "running", hasFrame: false, loading: false }), "starting");
  assert.equal(desktopPhase({ status: "running", hasFrame: true, loading: false }), "running");
  assert.equal(desktopPhase({ status: "idle", hasFrame: true, loading: true }), "running");
  assert.equal(desktopPhase({ status: undefined, hasFrame: false, loading: false }), "starting");
});

test("workspaceOffline only reports statuses that cannot serve a desktop", () => {
  assert.equal(workspaceOffline("IDLE"), true);
  assert.equal(workspaceOffline("unbound"), true);
  assert.equal(workspaceOffline("running"), false);
  assert.equal(workspaceOffline("created"), false);
  assert.equal(workspaceOffline(undefined), false);
});
