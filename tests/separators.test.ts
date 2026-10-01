import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTranscriptRows, chatReducer, dividerDayLabel, emptyChatState, type TranscriptRow } from "../lib/chat-state";
import type { ChatMessage } from "../lib/types";
import { agents } from "./helpers";

const now = new Date(2026, 9, 1, 12, 0, 0).getTime();
const day = (offset: number, hour = 9): number => new Date(2026, 9, 1 + offset, hour, 0, 0).getTime();

const message = (id: string, role: "user" | "assistant", createdAt: number,
  kind: "text" | "activity" | "system" = "text"): ChatMessage => ({ id, agentId: "a", role, kind, text: id, createdAt });
const reply = (id: string, createdAt: number): ChatMessage => message(id, "assistant", createdAt);
const kinds = (rows: TranscriptRow[]): string[] => rows.map((row) => row.kind);
const dividerRows = (rows: TranscriptRow[]) => rows.filter((row): row is Extract<TranscriptRow, { kind: "day" | "unread" }> =>
  row.kind === "day" || row.kind === "unread");
const messageRows = (rows: TranscriptRow[]) => rows.flatMap((row) => row.kind === "msg" ? [row.message.id] : []);
const indexOfMessage = (rows: TranscriptRow[], id: string): number =>
  rows.findIndex((row) => row.kind === "msg" && row.message.id === id);

test("a date divider opens the transcript and marks every calendar-day change", () => {
  const rows = buildTranscriptRows([
    message("m1", "assistant", day(0, 9)),
    message("m2", "user", day(0, 10)),
    message("m3", "assistant", day(-1, 9)),
    message("m4", "assistant", day(-2, 9)),
  ], null, now);

  assert.deepEqual(kinds(rows), ["day", "msg", "msg", "day", "msg", "day", "msg"]);
  assert.deepEqual(messageRows(rows), ["m1", "m2", "m3", "m4"], "the top of the loaded transcript always opens with a divider");
  assert.deepEqual(dividerRows(rows).map((row) => row.label), ["Today", "Yesterday", new Date(day(-2)).toLocaleDateString(undefined, { weekday: "long" })]);
});

test("today and yesterday labels follow the local calendar", () => {
  assert.equal(dividerDayLabel(day(0), now), "Today");
  assert.equal(dividerDayLabel(day(-1), now), "Yesterday");
  const older = dividerDayLabel(day(-10), now);
  assert.ok(older.length > 0 && older !== "Today" && older !== "Yesterday");
});

test("an unread divider sits above the first unread assistant message and counts only replies", () => {
  const t = day(0, 8);
  const window = { from: t, to: t + 3 * 60_000 };
  const rows = buildTranscriptRows([
    reply("a1", t),
    message("u1", "user", t + 60_000),
    reply("a2", t + 120_000),
    reply("a3", t + 180_000),
  ], window, now);

  const unread = dividerRows(rows).filter((row) => row.kind === "unread");
  assert.equal(unread.length, 1, "exactly one unread divider is emitted");
  assert.equal(unread[0].label, "2 new messages");
  assert.equal(indexOfMessage(rows, "a2") - rows.indexOf(unread[0]), 1, "the divider precedes the first unread reply");
});

test("the unread divider is a frozen snapshot and ignores replies that arrive after opening", () => {
  const window = { from: day(0, 8), to: day(0, 9) };
  const before = buildTranscriptRows([reply("a1", day(0, 8)), reply("a2", day(0, 9))], window, now);
  const after = buildTranscriptRows([reply("a1", day(0, 8)), reply("a2", day(0, 9)), reply("a3", day(0, 10))], window, now);
  assert.equal(dividerRows(before).find((row) => row.kind === "unread")?.label, "1 new message");
  assert.equal(dividerRows(after).find((row) => row.kind === "unread")?.label, "1 new message",
    "a later reply is newer than the captured window and must not widen it");
});

test("no unread divider without a usable window or with nothing new", () => {
  const messages = [reply("a1", day(0, 8)), reply("a2", day(0, 9))];
  const hasUnread = (window: Parameters<typeof buildTranscriptRows>[1]) =>
    kinds(buildTranscriptRows(messages, window, now)).includes("unread");
  assert.equal(hasUnread(null), false);
  assert.equal(hasUnread({ from: 0, to: day(0, 9) }), false, "an unknown read boundary cannot claim history as unread");
  assert.equal(hasUnread({ from: day(0, 9), to: day(0, 8) }), false);
  assert.equal(hasUnread({ from: day(0, 9), to: day(0, 9) }), false);
  assert.equal(hasUnread({ from: day(0, 9), to: day(0, 11) }), false, "user-only activity is not unread");
});

test("backfilled older pages keep divider placement a function of timestamps", () => {
  const window = { from: day(0, 8), to: day(0, 9) };
  const page = [
    reply("old", day(-1, 22)),
    message("old_user", "user", day(-1, 23)),
    reply("a1", day(0, 8)),
    reply("a2", day(0, 9)),
  ];
  const rows = buildTranscriptRows(page, window, now);
  assert.equal(dividerRows(rows).filter((row) => row.kind === "unread").length, 1);
  assert.equal(indexOfMessage(rows, "a2") - indexOfMessage(rows, "a1"), 2, "only the divider sits between the read and unread replies");
  assert.deepEqual(messageRows(rows), ["old", "old_user", "a1", "a2"], "older backfill stays above the window");
});

test("activity messages are never counted as unread", () => {
  const window = { from: day(0, 8), to: day(0, 10) };
  const rows = buildTranscriptRows([
    reply("a1", day(0, 8)),
    message("tool", "assistant", day(0, 9), "activity"),
    reply("a2", day(0, 9) + 60_000),
  ], window, now);
  const unread = dividerRows(rows).find((row) => row.kind === "unread");
  assert.equal(unread?.label, "1 new message");
});

test("opening a thread freezes the unread window and later activity must not clear it", () => {
  let state = chatReducer(emptyChatState(), { type: "reset", agents, messages: { a: [reply("r1", 100)] } });
  state = chatReducer(state, { type: "view", visible: true });
  assert.equal(state.unreadWindowByAgent.a, undefined, "the first visit has no earlier read boundary");
  state = chatReducer(state, { type: "view", visible: false });
  state = chatReducer(state, { type: "message", message: reply("r2", 200) });
  state = chatReducer(state, { type: "message", message: reply("r3", 300) });

  state = chatReducer(state, { type: "view", visible: true });
  assert.deepEqual(state.unreadWindowByAgent.a, { from: 100, to: 300 });

  state = chatReducer(state, { type: "message", message: reply("r4", 400) });
  assert.deepEqual(state.unreadWindowByAgent.a, { from: 100, to: 300 }, "replies received while viewing stay out of the snapshot");

  state = chatReducer(state, { type: "agents", agents });
  assert.deepEqual(state.unreadWindowByAgent.a, { from: 100, to: 300 }, "a roster refresh must not clear the frozen window");

  state = chatReducer(state, { type: "view", visible: false });
  state = chatReducer(state, { type: "view", visible: true });
  assert.equal(state.unreadWindowByAgent.a, undefined, "reopening with nothing new clears the divider");
});
