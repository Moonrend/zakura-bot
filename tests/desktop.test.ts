import assert from "node:assert/strict";
import { test } from "node:test";
import { desktopPath, parseDesktopInfo } from "../lib/desktop";

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
