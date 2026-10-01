import assert from "node:assert/strict";
import { test } from "node:test";
import { findMatches, searchableText } from "../lib/find-in-chat";
import type { ChatMessage } from "../lib/types";

const message = (id: string, text?: string, attachments?: ChatMessage["attachments"]): ChatMessage =>
  ({ id, agentId: "a", role: "assistant", kind: "text", text, attachments, createdAt: 1 });

test("an empty query matches nothing", () => {
  assert.deepEqual(findMatches([message("m", "hello")], ""), []);
});

test("matching is case-insensitive substring, ordered by message", () => {
  const messages = [message("a", "Hello world"), message("b", "no match"), message("c", "Say hello again")];
  assert.deepEqual(findMatches(messages, "hello").map((match) => match.messageId), ["a", "c"]);
  assert.deepEqual(findMatches(messages, "HELLO").map((match) => match.messageId), ["a", "c"]);
});

test("several occurrences in one message become separate matches for that message", () => {
  const matches = findMatches([message("m", "the cat and the hat")], "the");
  assert.deepEqual(matches.map((match) => match.messageId), ["m", "m"]);
});

test("occurrences are counted without overlap", () => {
  assert.equal(findMatches([message("m", "aaaa")], "aa").length, 2);
});

test("attachment names are searchable", () => {
  const file = { url: "https://example.test/x", name: "quarterly-report.pdf" };
  assert.deepEqual(findMatches([message("m", undefined, [file])], "report").map((match) => match.messageId), ["m"]);
});

test("searchableText joins message text and attachment names", () => {
  const text = searchableText(message("m", "caption", [{ url: "u", name: "photo.png" }]));
  assert.ok(text.includes("caption"));
  assert.ok(text.includes("photo.png"));
});

test("messages without visible text never match", () => {
  assert.deepEqual(findMatches([message("m")], "anything"), []);
});
