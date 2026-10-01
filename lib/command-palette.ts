import type { Agent, ChatMessage } from "./types";

export type CommandKind = "agent" | "message" | "setting";

export type CommandAction =
  | { type: "select-agent"; agentId: string }
  | { type: "open"; path: "/settings" | "/bots" }
  | { type: "sign-out" };

export interface CommandEntry {
  id: string;
  kind: CommandKind;
  group: string;
  label: string;
  detail?: string;
  keywords?: string;
  action: CommandAction;
}

export const MESSAGE_RESULT_LIMIT = 20;

const AGENTS_GROUP = "Agents";
const MESSAGES_GROUP = "Messages";
const SETTINGS_GROUP = "Settings";

function collapse(value?: string): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function settingsCommands(): CommandEntry[] {
  return [
    { id: "setting.open-settings", kind: "setting", group: SETTINGS_GROUP, label: "Go to settings", action: { type: "open", path: "/settings" } },
    { id: "setting.new-agent", kind: "setting", group: SETTINGS_GROUP, label: "New agent", action: { type: "open", path: "/bots" } },
    { id: "setting.sign-out", kind: "setting", group: SETTINGS_GROUP, label: "Sign out", action: { type: "sign-out" } },
  ];
}

export function agentCommands(agents: Agent[]): CommandEntry[] {
  return agents.map((agent) => ({
    id: `agent.${agent.id}`,
    kind: "agent" as const,
    group: AGENTS_GROUP,
    label: agent.name,
    detail: collapse(agent.description) || agent.title,
    keywords: collapse([agent.title, agent.description].filter(Boolean).join(" ")) || undefined,
    action: { type: "select-agent" as const, agentId: agent.id },
  }));
}

export function messageCommands(agents: Agent[], messagesByAgent: Record<string, ChatMessage[]>): CommandEntry[] {
  const nameById = new Map(agents.map((agent) => [agent.id, agent.name]));
  const rows: { createdAt: number; entry: CommandEntry }[] = [];
  for (const [agentId, messages] of Object.entries(messagesByAgent)) {
    const agentName = nameById.get(agentId);
    if (!agentName) continue;
    for (const message of messages) {
      const text = collapse(message.text);
      if (!text) continue;
      rows.push({ createdAt: message.createdAt, entry: {
        id: `message.${agentId}.${message.id}`, kind: "message", group: MESSAGES_GROUP,
        label: text, detail: agentName, action: { type: "select-agent", agentId } } });
    }
  }
  rows.sort((left, right) => right.createdAt - left.createdAt);
  return rows.map((row) => row.entry);
}

export function commandEntries(agents: Agent[], messagesByAgent: Record<string, ChatMessage[]>): CommandEntry[] {
  return [...agentCommands(agents), ...messageCommands(agents, messagesByAgent), ...settingsCommands()];
}

/** Substring first, then prefix, then subsequence; higher is a better match. Null excludes the row. */
export function matchRank(query: string, text: string): number | null {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return 0;
  const haystack = text.toLocaleLowerCase();
  if (!haystack) return null;
  const index = haystack.indexOf(needle);
  if (index === 0) return 3000 - Math.min(haystack.length - needle.length, 1000);
  if (index > 0) return 2000 - Math.min(index, 1000);
  let cursor = 0;
  let first = -1;
  let last = -1;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found === -1) return null;
    if (first === -1) first = found;
    last = found;
    cursor = found + 1;
  }
  return Math.max(1, 1000 - (last - first + 1 - needle.length));
}

const KIND_WEIGHT: Record<CommandKind, number> = { agent: 300, message: 100, setting: 200 };
const SECTION_ORDER: CommandKind[] = ["agent", "message", "setting"];

function entryScore(entry: CommandEntry, needle: string): number | null {
  const label = matchRank(needle, entry.label);
  const keyword = entry.keywords ? matchRank(needle, entry.keywords) : null;
  // Messages match on their text only; keywords belong to agents.
  let best = label === null ? -1 : label + (entry.kind === "message" ? 0 : 200);
  if (keyword !== null) best = Math.max(best, keyword);
  if (best < 0) return null;
  return best + KIND_WEIGHT[entry.kind];
}

export function rankCommandEntries(entries: CommandEntry[], query: string): CommandEntry[] {
  const needle = query.trim();
  if (!needle) return entries.filter((entry) => entry.kind !== "message");
  const byKind = new Map<CommandKind, { entry: CommandEntry; score: number; index: number }[]>();
  entries.forEach((entry, index) => {
    const score = entryScore(entry, needle);
    if (score === null) return;
    const rows = byKind.get(entry.kind) ?? [];
    rows.push({ entry, score, index });
    byKind.set(entry.kind, rows);
  });
  const result: CommandEntry[] = [];
  for (const kind of SECTION_ORDER) {
    const rows = (byKind.get(kind) ?? []).sort((left, right) => right.score - left.score || left.index - right.index);
    const limit = kind === "message" ? MESSAGE_RESULT_LIMIT : rows.length;
    for (const row of rows.slice(0, limit)) result.push(row.entry);
  }
  return result;
}
