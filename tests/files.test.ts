import assert from "node:assert/strict";
import { test } from "node:test";
import { botFilePath, MAX_FILE_BYTES, parseUploadedFile, validatePickedFiles, type PickedFile } from "../lib/files";
import { attachmentReferences, decodeServerFrame } from "../lib/channel/protocol";
import { chatReducer, emptyChatState } from "../lib/chat-state";
import { zakuraBinaryRequest, ZakuraApiError } from "../lib/auth";
import { agents, liveHarness } from "./helpers";

const file = { id: "file-1", name: "report.txt", mime: "text/plain", size: 12, type: "file" as const,
  url: "https://zakura.example/prefix/api/zakurabot/agents/a/files/file-1" };

test("file selection enforces the server's count and byte limits before upload", () => {
  const picked: PickedFile = { uri: "file://report", name: file.name, mime: file.mime, size: MAX_FILE_BYTES };
  validatePickedFiles([picked], 7);
  assert.throws(() => validatePickedFiles([picked], 8), /8 attachments/);
  for (const size of [0, -1, NaN, MAX_FILE_BYTES + 1]) assert.throws(() => validatePickedFiles([{ ...picked, size }]));
  assert.deepEqual(parseUploadedFile(file), file);
  assert.throws(() => parseUploadedFile({ ...file, url: "file:///workspace/report.txt" }));
  assert.throws(() => parseUploadedFile({ ...file, id: "__proto__" }));
  assert.equal(botFilePath("bot/one", "file/two"), "/api/zakurabot/agents/bot%2Fone/files/file%2Ftwo");
  assert.deepEqual(attachmentReferences([file]), [{ fileId: file.id }]);
  assert.throws(() => attachmentReferences([file, file]));
  assert.throws(() => attachmentReferences([{ url: "https://example.com/unuploaded.pdf" }]));
});

test("attachment-only receipts retain metadata and settle one optimistic bubble", () => {
  const frame = decodeServerFrame(JSON.stringify({ type: "message", message: {
    id: "server-id", clientMessageId: "local-id", agentId: "a", role: "user", kind: "text", text: "", attachments: [file], createdAt: 1,
  } }));
  assert.equal(frame?.type, "message");
  if (frame?.type !== "message") return;
  let state = chatReducer(emptyChatState(), { type: "agents", agents });
  state = chatReducer(state, { type: "optimistic", message: { ...frame.message, id: "local-id", clientMessageId: undefined } });
  state = chatReducer(state, frame);
  assert.equal(state.messagesByAgent.a?.length, 1);
  assert.equal(state.messagesByAgent.a?.[0]?.pending, false);
  assert.deepEqual(state.messagesByAgent.a?.[0]?.attachments, [file]);
  assert.equal(chatReducer(state, { type: "message", message: { ...frame.message, attachments: [{ ...file, id: "other" }] } }), state);
  assert.throws(() => decodeServerFrame(JSON.stringify({ type: "message", message: { ...frame.message, attachments: [] } })));
});

test("file sends use only uploaded IDs, reject conflicting receipts and keep IDs stable on retry", async () => {
  const { client, sockets, events } = liveHarness();
  const connect = client.connect(); sockets[0]!.open(); sockets[0]!.ready(); await connect;
  const input = { agentId: "a", text: "", clientMessageId: "attachment-only", attachments: [file] };
  try {
    await client.sendMessage(input);
    assert.deepEqual(sockets[0]!.sent.at(-1), { type: "send", agentId: "a", clientMessageId: "attachment-only", text: "📎 report.txt", attachments: [{ fileId: "file-1" }] });
    const receipt = { type: "message", message: { id: input.clientMessageId, clientMessageId: input.clientMessageId,
      agentId: "a", role: "user", kind: "text", text: "📎 report.txt", attachments: [file], createdAt: 1 } };
    sockets[0]!.frame({ ...receipt, message: { ...receipt.message, attachments: [{ ...file, id: "wrong" }] } });
    assert.equal(events.filter((event) => event.type === "message").length, 0);
    sockets[0]!.frame(receipt);
    assert.equal(events.filter((event) => event.type === "message").length, 1);
    const writes = sockets[0]!.sent.length;
    await client.sendMessage(input);
    assert.equal(sockets[0]!.sent.length, writes);
    await assert.rejects(client.sendMessage({ ...input, attachments: [{ ...file, id: "different" }] }), /different attachments/);
  } finally { client.disconnect(); }
});

test("binary downloads preserve instance prefixes, require bearer headers, and return API failures", async () => {
  const result = await zakuraBinaryRequest("https://zakura.example/prefix", botFilePath("a", file.id), {
    headers: { Authorization: "Bearer device-token" },
  }, async (url, init) => {
    assert.equal(url, file.url);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer device-token");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "error");
    return new Response("File content", { headers: { "Content-Type": "text/plain" } });
  });
  assert.equal(await result.blob.text(), "File content");
  await assert.rejects(zakuraBinaryRequest("https://zakura.example", botFilePath("a", file.id), {}, async () =>
    new Response(JSON.stringify({ error: "File not found" }), { status: 404 })), (error: unknown) => error instanceof ZakuraApiError && error.status === 404);
});
