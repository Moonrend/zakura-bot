import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCronPattern,
  describeRunRow,
  filterRunsForSchedule,
  formatClock,
  formatNextRun,
  frequencyFromPattern,
  isValidSchedulePattern,
  isValidTimezone,
  parseRoutineList,
  parseRoutineRuns,
  relativeTime,
  routinePatternIssue,
  timeOfDayOptions,
  type RoutineRun,
} from "../lib/routines.js";

test("the picker emits the exact cron strings the server accepts", () => {
  assert.equal(buildCronPattern({ kind: "minutes", every: 15 }), "*/15 * * * *");
  assert.equal(buildCronPattern({ kind: "minutes", every: 30 }), "*/30 * * * *");
  assert.equal(buildCronPattern({ kind: "hourly" }), "0 * * * *");
  assert.equal(buildCronPattern({ kind: "daily", hour: 9, minute: 30 }), "30 9 * * *");
  assert.equal(buildCronPattern({ kind: "weekly", weekday: 1, hour: 8, minute: 0 }), "0 8 * * 1");
  assert.equal(buildCronPattern({ kind: "custom", pattern: "  0 9 * * 1-5  " }), "0 9 * * 1-5");
});

test("known patterns recover their picker state and everything else stays custom", () => {
  assert.deepEqual(frequencyFromPattern("*/15 * * * *"), { kind: "minutes", every: 15 });
  assert.deepEqual(frequencyFromPattern("*/30 * * * *"), { kind: "minutes", every: 30 });
  assert.deepEqual(frequencyFromPattern("0 * * * *"), { kind: "hourly" });
  assert.deepEqual(frequencyFromPattern("@daily"), { kind: "daily", hour: 0, minute: 0 });
  assert.deepEqual(frequencyFromPattern("@weekly"), { kind: "weekly", weekday: 0, hour: 0, minute: 0 });
  assert.deepEqual(frequencyFromPattern("30 9 * * *"), { kind: "daily", hour: 9, minute: 30 });
  assert.deepEqual(frequencyFromPattern("0 8 * * 1"), { kind: "weekly", weekday: 1, hour: 8, minute: 0 });
  assert.deepEqual(frequencyFromPattern("0 9 * * 1-5"), { kind: "custom", pattern: "0 9 * * 1-5" });
});

test("pattern validation mirrors the server grammar", () => {
  for (const pattern of ["*/15 * * * *", "0 9 * * 1-5", "@hourly", "@daily", "@weekly", "@monthly",
    "@every 5m", "@every_2h", "CRON_TZ=Asia/Shanghai 0 9 * * 1-5"]) {
    assert.equal(isValidSchedulePattern(pattern), true, pattern);
  }
  for (const pattern of ["", "not a cron", "@every_0m", "@every_1m", "@every 3m",
    "60 * * * *", "* 24 * * *", "0 0 32 * *", "CRON_TZ=Not/AZone 0 9 * * *"]) {
    assert.equal(isValidSchedulePattern(pattern), false, pattern);
  }
  assert.equal(routinePatternIssue(""), "Enter a schedule.");
  assert.match(routinePatternIssue("garbage")!, /Use 5 fields/);
  assert.equal(routinePatternIssue("not a cron"), routinePatternIssue("garbage"));
  assert.match(routinePatternIssue("CRON_TZ=Not/AZone 0 9 * * *")!, /time zone/);
  assert.equal(routinePatternIssue("*/15 * * * *"), null);
  assert.equal(isValidTimezone("UTC"), true);
  assert.equal(isValidTimezone("Not/AZone"), false);
});

test("the time picker steps in 15 minutes", () => {
  const options = timeOfDayOptions();
  assert.equal(options.length, 96);
  assert.deepEqual([options[0]!.hour, options[0]!.minute, options[0]!.label], [0, 0, "12:00 AM"]);
  assert.deepEqual([options[1]!.hour, options[1]!.minute], [0, 15]);
  assert.deepEqual([options[95]!.hour, options[95]!.minute], [23, 45]);
  assert.equal(formatClock(9, 5), "9:05 AM");
  assert.equal(formatClock(13, 30), "1:30 PM");
  assert.equal(formatClock(0, 0), "12:00 AM");
  assert.equal(formatClock(12, 0), "12:00 PM");
});

test("next-run labels combine an absolute day with a relative hint", () => {
  const now = new Date(2026, 9, 1, 12, 0, 0).getTime();
  assert.equal(formatNextRun(null, now), "Not scheduled");
  assert.equal(formatNextRun("nope", now), "Not scheduled");
  assert.equal(relativeTime(now + 15 * 60_000, now), "in 15 min");
  assert.equal(relativeTime(now + 2 * 3_600_000, now), "in 2 hr");
  assert.equal(relativeTime(now - 5 * 60_000, now), "5 min ago");
  const today = new Date(2026, 9, 1, 12, 15, 0).getTime();
  assert.equal(formatNextRun(new Date(today).toISOString(), now), `Today at ${new Date(today).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · in 15 min`);
  const tomorrow = new Date(2026, 9, 2, 9, 0, 0).getTime();
  assert.match(formatNextRun(new Date(tomorrow).toISOString(), now), /^Tomorrow at /);
});

test("run rows project status, times and error text", () => {
  const now = new Date(2026, 9, 1, 12, 0, 0).getTime();
  const run: RoutineRun = {
    id: "r1", agentId: "a1", kind: "schedule", scheduleId: "s1", sessionId: "sess", cloudRunId: null,
    status: "completed", prompt: "go", resultText: null, error: null,
    startedAt: new Date(2026, 9, 1, 9, 0, 0).toISOString(), completedAt: new Date(2026, 9, 1, 9, 1, 0).toISOString(),
    createdAt: new Date(2026, 9, 1, 9, 0, 0).toISOString(),
  };
  const row = describeRunRow(run, now);
  assert.equal(row.status, "Started");
  assert.match(row.started, /^Today at /);
  assert.match(row.completed!, /^Today at /);
  assert.equal(row.error, null);
  assert.equal(describeRunRow({ ...run, status: "failed", error: "boom" }, now).status, "Failed");
});

test("routines and runs parse defensively", () => {
  const list = parseRoutineList({ schedules: [{ id: "s1", agentId: "a1", name: "Digest", enabled: false, pattern: "0 9 * * *" }] });
  assert.deepEqual(list.map((row) => [row.id, row.name, row.enabled, row.pattern, row.timezone]), [["s1", "Digest", false, "0 9 * * *", "UTC"]]);
  assert.throws(() => parseRoutineList({}), /invalid routine/);
  assert.throws(() => parseRoutineList({ schedules: [{ name: "no id" }] }));

  const runs = parseRoutineRuns({ runs: [
    { id: "r1", agentId: "a1", scheduleId: "s1", status: "failed", startedAt: "2026-10-01T09:00:00.000Z", error: "boom" },
    { id: "r2", agentId: "a1", scheduleId: "s2", status: "completed" },
    { id: "r3", agentId: "a1", scheduleId: "s1", status: "completed" },
    { bad: true },
  ] });
  assert.deepEqual(runs.map((run) => run.id), ["r1", "r2", "r3"]);
  assert.deepEqual(filterRunsForSchedule(runs, "s1").map((run) => run.id), ["r1", "r3"]);
  assert.deepEqual(filterRunsForSchedule(runs, "s1", 1).map((run) => run.id), ["r1"]);
  assert.deepEqual(filterRunsForSchedule(runs, "missing"), []);
  assert.deepEqual(parseRoutineRuns(null), []);
});
