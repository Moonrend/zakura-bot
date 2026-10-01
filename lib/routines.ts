/** Agent routines (recurring scheduled tasks) over Zakura's tenant REST API. */

export type RoutineTriggerKind = "cron" | "listener";
export type RoutineRunStatus = "queued" | "running" | "completed" | "failed" | "skipped";

export interface RoutineSchedule {
  id: string;
  agentId: string;
  name: string;
  description: string;
  triggerKind: RoutineTriggerKind;
  pattern: string;
  listenerSummary: string | null;
  webhookUrl: string | null;
  hasWebhookSecret: boolean;
  prompt: string;
  project: string | null;
  enabled: boolean;
  maxRuns: number | null;
  runCount: number;
  timezone: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineRun {
  id: string;
  agentId: string;
  kind: string;
  scheduleId: string | null;
  sessionId: string | null;
  cloudRunId: string | null;
  status: RoutineRunStatus;
  prompt: string;
  resultText: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface RoutineDraft {
  name?: string;
  description?: string;
  pattern?: string;
  prompt?: string;
  project?: string | null;
  enabled?: boolean;
  maxRuns?: number | null;
  timezone?: string;
}

export const routinesPath = (agentId: string) => `/api/agents/${encodeURIComponent(agentId)}/routines`;
export const routinePath = (agentId: string, scheduleId: string) =>
  `${routinesPath(agentId)}/${encodeURIComponent(scheduleId)}`;
export const routineRunPath = (agentId: string, scheduleId: string) => `${routinePath(agentId, scheduleId)}/run`;
/** Agent-wide run feed; per-routine history filters this by scheduleId. */
export const automationRunsPath = (agentId: string, limit = 30) =>
  `/api/agents/${encodeURIComponent(agentId)}/automation/runs?limit=${limit}`;

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

const RUN_STATUSES: RoutineRunStatus[] = ["queued", "running", "completed", "failed", "skipped"];

export function parseRoutine(value: unknown): RoutineSchedule {
  const row = value as Record<string, unknown> | null;
  if (!row || typeof row.id !== "string" || typeof row.agentId !== "string" || typeof row.name !== "string") {
    throw new Error("Zakura returned invalid routine information.");
  }
  return {
    id: row.id,
    agentId: row.agentId,
    name: row.name,
    description: text(row.description),
    triggerKind: row.triggerKind === "listener" ? "listener" : "cron",
    pattern: text(row.pattern),
    listenerSummary: nullableText(row.listenerSummary),
    webhookUrl: nullableText(row.webhookUrl),
    hasWebhookSecret: row.hasWebhookSecret === true,
    prompt: text(row.prompt),
    project: nullableText(row.project),
    enabled: row.enabled !== false,
    maxRuns: typeof row.maxRuns === "number" && Number.isFinite(row.maxRuns) ? row.maxRuns : null,
    runCount: typeof row.runCount === "number" && Number.isFinite(row.runCount) ? row.runCount : 0,
    timezone: text(row.timezone, "UTC") || "UTC",
    nextRunAt: nullableText(row.nextRunAt),
    lastRunAt: nullableText(row.lastRunAt),
    lastStatus: nullableText(row.lastStatus),
    lastError: nullableText(row.lastError),
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt),
  };
}

export function parseRoutineList(value: unknown): RoutineSchedule[] {
  const rows = (value as { schedules?: unknown } | null)?.schedules;
  if (!Array.isArray(rows)) throw new Error("Zakura returned invalid routine information.");
  return rows.map(parseRoutine);
}

function parseRunRow(value: unknown): RoutineRun | null {
  const row = value as Record<string, unknown> | null;
  if (!row || typeof row.id !== "string" || typeof row.agentId !== "string") return null;
  const status = RUN_STATUSES.includes(row.status as RoutineRunStatus) ? row.status as RoutineRunStatus : "queued";
  return {
    id: row.id,
    agentId: row.agentId,
    kind: text(row.kind),
    scheduleId: nullableText(row.scheduleId),
    sessionId: nullableText(row.sessionId),
    cloudRunId: nullableText(row.cloudRunId),
    status,
    prompt: text(row.prompt),
    resultText: nullableText(row.resultText),
    error: nullableText(row.error),
    startedAt: nullableText(row.startedAt),
    completedAt: nullableText(row.completedAt),
    createdAt: text(row.createdAt),
  };
}

/** Malformed run rows are dropped; history stays usable even if one row is odd. */
export function parseRoutineRuns(value: unknown): RoutineRun[] {
  const rows = (value as { runs?: unknown } | null)?.runs;
  if (!Array.isArray(rows)) return [];
  return rows.map(parseRunRow).filter((row): row is RoutineRun => row !== null);
}

/** Keep only the newest runs for one routine; the feed arrives newest-first. */
export function filterRunsForSchedule(runs: RoutineRun[], scheduleId: string, limit = 5): RoutineRun[] {
  return runs.filter((run) => run.scheduleId === scheduleId).slice(0, limit);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface WeekdayOption {
  value: number;
  label: string;
}

export const WEEKDAY_OPTIONS: WeekdayOption[] = WEEKDAY_NAMES.map((label, value) => ({ value, label }));

function startOfDay(ts: number): number {
  const date = new Date(ts);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function clockLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Absolute local moment, matching the app's day/clock formatting. */
export function formatMoment(ts: number, now = Date.now()): string {
  const date = new Date(ts);
  const time = clockLabel(date);
  const diffDays = Math.round((startOfDay(ts) - startOfDay(now)) / 86_400_000);
  if (diffDays === 0) return `Today at ${time}`;
  if (diffDays === 1) return `Tomorrow at ${time}`;
  if (diffDays === -1) return `Yesterday at ${time}`;
  if (diffDays > 1 && diffDays < 7) return `${date.toLocaleDateString(undefined, { weekday: "long" })} at ${time}`;
  const day = date.toLocaleDateString(undefined, { month: "short", day: "numeric",
    ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" as const } : {}) });
  return `${day} at ${time}`;
}

/** Compact relative time for a moment; past and future share one phrasing. */
export function relativeTime(ts: number, now = Date.now()): string {
  const diff = ts - now;
  const past = diff < 0;
  const amount = Math.abs(diff);
  if (amount < 45_000) return past ? "just now" : "in a moment";
  if (amount < 60 * 60_000) {
    const minutes = Math.max(1, Math.round(amount / 60_000));
    return past ? `${minutes} min ago` : `in ${minutes} min`;
  }
  if (amount < 24 * 60 * 60_000) {
    const hours = Math.max(1, Math.round(amount / 3_600_000));
    return past ? `${hours} hr ago` : `in ${hours} hr`;
  }
  const days = Math.max(1, Math.round(amount / 86_400_000));
  return past ? `${days} d ago` : `in ${days} d`;
}

export function formatNextRun(nextRunAt: string | null, now = Date.now()): string {
  if (!nextRunAt) return "Not scheduled";
  const ts = Date.parse(nextRunAt);
  if (!Number.isFinite(ts)) return "Not scheduled";
  return `${formatMoment(ts, now)} · ${relativeTime(ts, now)}`;
}

export function formatRunMoment(value: string | null, now = Date.now()): string {
  if (!value) return "";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return "";
  return formatMoment(ts, now);
}

/**
 * Server "completed" means the session started, not that the agent finished.
 * Label it "Started" so history stays honest; the other states are literal.
 */
export function runStatusLabel(status: RoutineRunStatus): string {
  switch (status) {
    case "queued": return "Queued";
    case "running": return "Running";
    case "completed": return "Started";
    case "failed": return "Failed";
    case "skipped": return "Skipped";
  }
}

export interface RoutineRunRow {
  id: string;
  status: string;
  started: string;
  completed: string | null;
  error: string | null;
}

export function describeRunRow(run: RoutineRun, now = Date.now()): RoutineRunRow {
  return {
    id: run.id,
    status: runStatusLabel(run.status),
    started: formatRunMoment(run.startedAt ?? run.createdAt, now),
    completed: run.completedAt ? formatRunMoment(run.completedAt, now) : null,
    error: run.error,
  };
}

export type RoutineFrequency =
  | { kind: "minutes"; every: 15 | 30 }
  | { kind: "hourly" }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number }
  | { kind: "custom"; pattern: string };

/** Exact cron string the picker hands to the server. */
export function buildCronPattern(frequency: RoutineFrequency): string {
  switch (frequency.kind) {
    case "minutes": return `*/${frequency.every} * * * *`;
    case "hourly": return "0 * * * *";
    case "daily": return `${frequency.minute} ${frequency.hour} * * *`;
    case "weekly": return `${frequency.minute} ${frequency.hour} * * ${frequency.weekday}`;
    case "custom": return frequency.pattern.trim();
  }
}

/** Recover the picker state from a known pattern; anything else stays custom. */
export function frequencyFromPattern(pattern: string): RoutineFrequency {
  const raw = pattern.trim();
  if (raw === "*/15 * * * *") return { kind: "minutes", every: 15 };
  if (raw === "*/30 * * * *") return { kind: "minutes", every: 30 };
  const lower = raw.toLowerCase();
  if (raw === "0 * * * *" || lower === "@hourly") return { kind: "hourly" };
  if (lower === "@daily") return { kind: "daily", hour: 0, minute: 0 };
  if (lower === "@weekly") return { kind: "weekly", weekday: 0, hour: 0, minute: 0 };
  const fields = raw.split(/\s+/);
  if (fields.length === 5) {
    const minute = Number(fields[0]);
    const hour = Number(fields[1]);
    const dayOfMonth = fields[2];
    const month = fields[3];
    const dayOfWeek = fields[4];
    if (Number.isInteger(minute) && Number.isInteger(hour) && dayOfMonth === "*" && month === "*") {
      if (dayOfWeek === "*") return { kind: "daily", hour, minute };
      const weekday = Number(dayOfWeek);
      if (Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) return { kind: "weekly", weekday, hour, minute };
    }
  }
  return { kind: "custom", pattern: raw };
}

export interface ClockOption {
  hour: number;
  minute: number;
  label: string;
}

export function formatClock(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** 96 quarter-hour choices, the picker's 15-minute step. */
export function timeOfDayOptions(): ClockOption[] {
  return Array.from({ length: 24 * 4 }, (_, index) => {
    const total = index * 15;
    const hour = Math.floor(total / 60);
    const minute = total % 60;
    return { hour, minute, label: formatClock(hour, minute) };
  });
}

export const TIMEZONE_OPTIONS = [
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const EVERY_PATTERN = /^@every(?:_| )(\d+)\s*(m|h)$/i;
const CRON_TIMEZONE_PREFIX = /^CRON_TZ=(\S+)\s+(.+)$/i;
const CRON_ALIASES: Readonly<Record<string, string>> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
};

function validCronField(raw: string, min: number, max: number): boolean {
  for (const part of raw.split(",")) {
    const segment = part.trim();
    if (!segment) return false;
    const match = segment.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!match) return false;
    const step = match[2] ? Number(match[2]) : 1;
    if (!Number.isInteger(step) || step < 1) return false;
    let lo = min;
    let hi = max;
    const base = match[1]!;
    if (base !== "*") {
      if (base.includes("-")) {
        const [first, last] = base.split("-").map(Number);
        lo = first!;
        hi = last!;
      } else {
        lo = Number(base);
        hi = lo;
      }
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) return false;
  }
  return true;
}

/** Minimal port of the server's `assertValidSchedulePattern`. */
export function isValidSchedulePattern(pattern: string): boolean {
  const raw = pattern.trim();
  if (!raw) return false;
  const prefixed = raw.match(CRON_TIMEZONE_PREFIX);
  if (prefixed && !isValidTimezone(prefixed[1]!)) return false;
  const body = prefixed ? prefixed[2]!.trim() : raw;
  if (!body) return false;
  const every = body.match(EVERY_PATTERN);
  if (every) {
    const amount = Number(every[1]);
    const unit = every[2]!.toLowerCase();
    if (!Number.isInteger(amount) || amount < 1) return false;
    if (unit === "m") return amount <= 10_080 && amount * 60_000 >= 5 * 60_000;
    return amount <= 168;
  }
  const fields = (CRON_ALIASES[body.toLowerCase()] ?? body).split(/\s+/);
  if (fields.length !== 5) return false;
  return validCronField(fields[0]!, 0, 59) && validCronField(fields[1]!, 0, 23) &&
    validCronField(fields[2]!, 1, 31) && validCronField(fields[3]!, 1, 12) && validCronField(fields[4]!, 0, 6);
}

/** Client-side guard; the copy states the accepted grammar in one line. */
export function routinePatternIssue(pattern: string): string | null {
  const raw = pattern.trim();
  if (!raw) return "Enter a schedule.";
  const prefixed = raw.match(CRON_TIMEZONE_PREFIX);
  if (prefixed && !isValidTimezone(prefixed[1]!)) return "That time zone isn't recognized.";
  if (!isValidSchedulePattern(raw)) {
    return "Use 5 fields (minute hour day month weekday), @hourly/@daily/@weekly/@monthly, or @every 5m.";
  }
  return null;
}

export function routineNameError(name: string): string | null {
  return name.trim() ? null : "Enter a name for this routine.";
}

export function routinePromptError(prompt: string): string | null {
  return prompt.trim() ? null : "Enter the instruction this routine runs.";
}
