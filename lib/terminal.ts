/** Read-only command output for the desktop-web terminal over Zakura's exec API. */

export const TERMINAL_COMMAND_MAX = 2000;

export const execPath = (agentId: string) =>
  `/api/zakurabot/agents/${encodeURIComponent(agentId)}/exec`;

export type TerminalRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface ExecResult {
  output: string;
  exitCode: number;
  finishedAt: string;
  truncated: boolean;
}

export interface TerminalEntry {
  id: string;
  command: string;
  status: "running" | "done" | "failed";
  output?: string;
  exitCode?: number;
  truncated?: boolean;
  elapsedMs?: number;
  error?: string;
  hint?: string;
}

export interface TranscriptRow {
  key: string;
  kind: "command" | "pending" | "output" | "error";
  text: string;
  note: string | null;
  tone: "ink" | "muted" | "danger";
}

/** Mirrors the server's `command: z.string().min(1).max(2000)`. */
export function validateCommand(value: string): string | null {
  if (value.length === 0) return "Enter a command.";
  if (value.length > TERMINAL_COMMAND_MAX) return `Commands are limited to ${TERMINAL_COMMAND_MAX} characters.`;
  return null;
}

export function parseExecResult(value: unknown): ExecResult {
  const row = value as Record<string, unknown> | null;
  if (!row || typeof row.output !== "string" || typeof row.exitCode !== "number" || !Number.isFinite(row.exitCode)) {
    throw new Error("Zakura returned an invalid command result.");
  }
  return {
    output: row.output,
    exitCode: row.exitCode,
    finishedAt: typeof row.finishedAt === "string" ? row.finishedAt : "",
    truncated: row.truncated === true,
  };
}

export const runCommand = (request: TerminalRequest, agentId: string, command: string): Promise<ExecResult> =>
  request<unknown>(execPath(agentId), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command }),
  }).then(parseExecResult);

export function exitNote(exitCode: number): string | null {
  return exitCode === 0 ? null : `exit code ${exitCode}`;
}

export function truncationNote(truncated: boolean): string | null {
  return truncated ? "Output trimmed." : null;
}

export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

/** Server messages surface plainly; the running-workspace failure adds start guidance. */
export function describeExecFailure(status: number | null, message: string): { message: string; hint: string | null } {
  if (status === 409) return { message, hint: "Start this agent's computer in Zakura, then run the command again." };
  return { message, hint: null };
}

export function buildTranscript(entries: TerminalEntry[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  for (const entry of entries) {
    rows.push({ key: `${entry.id}:command`, kind: "command", text: entry.command, note: null, tone: "ink" });
    if (entry.status === "running") {
      rows.push({ key: `${entry.id}:output`, kind: "pending", text: "", note: null, tone: "muted" });
      continue;
    }
    if (entry.status === "failed") {
      rows.push({ key: `${entry.id}:output`, kind: "error", text: entry.error ?? "The command could not run.",
        note: entry.hint ?? null, tone: "danger" });
      continue;
    }
    const notes = [exitNote(entry.exitCode ?? 0), truncationNote(entry.truncated === true)];
    if (entry.elapsedMs !== undefined) notes.push(formatElapsed(entry.elapsedMs));
    rows.push({ key: `${entry.id}:output`, kind: "output", text: entry.output ?? "",
      note: notes.filter((note): note is string => !!note).join(" · ") || null, tone: "ink" });
  }
  return rows;
}
