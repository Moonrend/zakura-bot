import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { LiveZakuraChannelClient } from "../lib/channel/live-client";
import type { ChannelEvent } from "../lib/channel/types";
import { botFilePath, parseUploadedFile } from "../lib/files";
import { zakuraBinaryRequest, zakuraRequest } from "../lib/auth";

const serverRoot = resolve(process.env.ZAKURA_SERVER_PATH ?? "../Zakura");
test("the app client uploads, delivers and downloads files through Zakura's real HTTP/WS/DB stack", async () => {
  const { zakurabotHarness } = await import(pathToFileURL(resolve(serverRoot, "apps/server/test/helpers/zakurabot.ts")).href);
  const h = await zakurabotHarness();
  let client: LiveZakuraChannelClient | undefined;
  try {
    const context = await h.access(), agentId: string = context.bindings[0].agentId;
    const headers = { Authorization: `Bearer ${context.token}` };
    const body = new FormData(); body.append("file", new Blob(["Cross-repository attachment"], { type: "text/plain" }), "integration.txt");
    const upload = await zakuraRequest<{ file: unknown }>(h.url, botFilePath(agentId), { method: "POST", headers, body });
    const file = parseUploadedFile(upload.file);
    client = new LiveZakuraChannelClient({ baseUrl: h.url, token: context.token, WebSocketImpl: WebSocket, heartbeatMs: 0 });
    const events: ChannelEvent[] = [];
    client.subscribe((event) => events.push(event));
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { unsubscribe(); reject(new Error(`Handshake missing: ${JSON.stringify(events)}`)); }, 5000);
      const unsubscribe = client!.subscribe((event) => {
        if (event.type === "connection" && event.state === "connected") { clearTimeout(timer); unsubscribe(); resolve(); }
      });
    });
    await client.connect();
    await ready;
    const echo = new Promise<ChannelEvent>((resolve, reject) => {
      const timer = setTimeout(() => { unsubscribe(); reject(new Error(`File receipt missing: ${JSON.stringify(events)}`)); }, 5000);
      const unsubscribe = client!.subscribe((event) => {
        if (event.type === "message" && event.message.clientMessageId === "integration-file") { clearTimeout(timer); unsubscribe(); resolve(event); }
      });
    });
    await client.sendMessage({ agentId, text: "", attachments: [file], clientMessageId: "integration-file" });
    const receipt = await echo;
    assert.equal(receipt.type, "message");
    if (receipt.type !== "message") throw new Error("Missing message receipt");
    assert.deepEqual(receipt.message.attachments, [file]);
    assert.equal(receipt.message.text, "📎 integration.txt");
    const run = await h.waitForRun("integration-file");
    assert.equal(run.attachments[0].name, "integration.txt");
    assert.match(run.attachments[0].path, /^\/workspace\/uploads\/zakurabot\//);
    const download = await zakuraBinaryRequest(h.url, botFilePath(agentId, file.id), { headers });
    assert.equal(await download.blob.text(), "Cross-repository attachment");
    await run.finish();
    const before = h.runs.length;
    await client.sendMessage({ agentId, text: "", attachments: [file], clientMessageId: "integration-file" });
    assert.equal(h.runs.length, before);
  } finally { client?.disconnect(); await h.close(); }
});
