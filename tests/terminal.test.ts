import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTranscript, describeExecFailure, execPath, exitNote, formatElapsed, parseExecResult, runCommand, truncationNote, validateCommand,
} from "../lib/terminal";

test("exec path encodes the agent id", () => {
  assert.equal(execPath("bot/one"), "/api/zakurabot/agents/bot%2Fone/exec");
});

test("command validation mirrors the server's 1-2000 characters", () => {
  assert.equal(validateCommand(""), "Enter a command.");
  assert.equal(validateCommand("ls"), null);
  assert.equal(validateCommand("x".repeat(2000)), null);
  assert.equal(validateCommand("x".repeat(2001)), "Commands are limited to 2000 characters.");
});

test("parseExecResult keeps output, exit code and truncation and rejects malformed payloads", () => {
  const result = parseExecResult({ output: "hi", exitCode: 2, finishedAt: "2026-09-17T12:00:00Z", truncated: true, extra: 1 });
  assert.deepEqual(result, { output: "hi", exitCode: 2, finishedAt: "2026-09-17T12:00:00Z", truncated: true });
  assert.equal(parseExecResult({ output: "", exitCode: 0 }).truncated, false);
  assert.throws(() => parseExecResult({ output: 1, exitCode: 0 }), /invalid command result/);
  assert.throws(() => parseExecResult(null), /invalid command result/);
});

test("notes surface non-zero exits and trimmed output only when relevant", () => {
  assert.equal(exitNote(0), null);
  assert.equal(exitNote(127), "exit code 127");
  assert.equal(truncationNote(false), null);
  assert.equal(truncationNote(true), "Output trimmed.");
});

test("elapsed formatting stays compact", () => {
  assert.equal(formatElapsed(420), "0.4s");
  assert.equal(formatElapsed(12_400), "12s");
  assert.equal(formatElapsed(Number.NaN), "");
});

test("buildTranscript shapes a running command into a command row plus a pending row", () => {
  const rows = buildTranscript([{ id: "a", command: "ls -la", status: "running" }]);
  assert.deepEqual(rows.map((row) => row.kind), ["command", "pending"]);
  assert.equal(rows[0].text, "ls -la");
});

test("buildTranscript joins exit, truncation and elapsed notes after a completed command", () => {
  const rows = buildTranscript([{ id: "b", command: "make test", status: "done", output: "boom", exitCode: 1, truncated: true, elapsedMs: 700 }]);
  assert.equal(rows[1].kind, "output");
  assert.equal(rows[1].text, "boom");
  assert.equal(rows[1].note, "exit code 1 · Output trimmed. · 0.7s");
  const clean = buildTranscript([{ id: "c", command: "true", status: "done", output: "", exitCode: 0, elapsedMs: 100 }]);
  assert.equal(clean[1].note, "0.1s");
});

test("buildTranscript carries the server failure and its guidance separately", () => {
  const rows = buildTranscript([{ id: "d", command: "ls", status: "failed", error: "Workspace is not running. Start the agent first.", hint: "Start this agent's computer in Zakura, then run the command again." }]);
  assert.equal(rows[1].kind, "error");
  assert.equal(rows[1].text, "Workspace is not running. Start the agent first.");
  assert.equal(rows[1].note, "Start this agent's computer in Zakura, then run the command again.");
});

test("runCommand posts the command to the agent exec route and shapes the reply", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, init });
    return { output: "hello", exitCode: 0, finishedAt: "2026-09-17T12:00:00Z", truncated: false } as T;
  };
  const result = await runCommand(request, "bot/one", "echo hello");
  assert.equal(calls[0].path, "/api/zakurabot/agents/bot%2Fone/exec");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { command: "echo hello" });
  assert.deepEqual(result, { output: "hello", exitCode: 0, finishedAt: "2026-09-17T12:00:00Z", truncated: false });
});

test("describeExecFailure adds start guidance only for a stopped workspace", () => {
  assert.deepEqual(describeExecFailure(409, "Workspace is not running. Start the agent first."),
    { message: "Workspace is not running. Start the agent first.", hint: "Start this agent's computer in Zakura, then run the command again." });
  assert.deepEqual(describeExecFailure(400, "command must be 1-2000 characters"), { message: "command must be 1-2000 characters", hint: null });
  assert.deepEqual(describeExecFailure(null, "Network down"), { message: "Network down", hint: null });
});
