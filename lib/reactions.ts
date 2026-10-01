/** Message reactions: REST helpers plus pure projections for the picker and pills. */

export const QUICK_REACTIONS = ["👍", "👎", "❤️", "😂", "🎉", "😮"] as const;

/** Fixed grid behind "More". Deliberately small and dependency-free. */
export const MORE_REACTIONS = [
  "😀", "😅", "😊", "🙌", "👏", "🔥", "✅", "❌", "🙏", "💯", "😍", "🤔",
  "😢", "😡", "🚀", "👀", "💪", "🤝", "🥳", "😴", "🤯", "😬", "✨", "⭐",
] as const;

export interface ReactionRow {
  messageId: string;
  emoji: string;
  userId: string;
}

/** One reaction per user per message, so a plain map keys the message's reactions. */
export type ReactionMap = Record<string, string>;

export interface ReactionPill {
  emoji: string;
  count: number;
  mine: boolean;
}

export type ReactionRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export const reactionsPath = (agentId: string, messageId: string) =>
  `/api/zakurabot/agents/${encodeURIComponent(agentId)}/messages/${encodeURIComponent(messageId)}/reactions`;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseRow(value: unknown): ReactionRow | null {
  const row = asRecord(value);
  if (typeof row.messageId !== "string" || !row.messageId || typeof row.userId !== "string" || !row.userId ||
    typeof row.emoji !== "string" || !row.emoji.trim()) return null;
  return { messageId: row.messageId, emoji: row.emoji, userId: row.userId };
}

export function parseReactionRows(value: unknown): ReactionRow[] {
  const rows = asRecord(value).reactions;
  if (!Array.isArray(rows)) return [];
  return rows.map(parseRow).filter((row): row is ReactionRow => row !== null);
}

export function toReactionMap(rows: ReactionRow[]): ReactionMap {
  const map: ReactionMap = {};
  for (const row of rows) map[row.userId] = row.emoji;
  return map;
}

/** Group a message's reactions by emoji, first-seen order, marking the current user's own. */
export function projectReactionPills(byUser: ReactionMap | undefined, currentUserId: string | null): ReactionPill[] {
  const order: string[] = [];
  const groups = new Map<string, { count: number; mine: boolean }>();
  for (const [userId, emoji] of Object.entries(byUser ?? {})) {
    if (!emoji) continue;
    const group = groups.get(emoji);
    if (group) {
      group.count += 1;
      if (userId === currentUserId) group.mine = true;
    } else {
      order.push(emoji);
      groups.set(emoji, { count: 1, mine: userId === currentUserId });
    }
  }
  return order.map((emoji) => {
    const group = groups.get(emoji)!;
    return { emoji, count: group.count, mine: group.mine };
  });
}

export const listReactions = (request: ReactionRequest, agentId: string, messageId: string): Promise<ReactionRow[]> =>
  request<unknown>(reactionsPath(agentId, messageId)).then(parseReactionRows);

export const addReaction = (request: ReactionRequest, agentId: string, messageId: string, emoji: string): Promise<void> =>
  request(reactionsPath(agentId, messageId), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji }),
  }).then(() => undefined);

export const removeReaction = (request: ReactionRequest, agentId: string, messageId: string, emoji: string): Promise<boolean> =>
  request<unknown>(reactionsPath(agentId, messageId), {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji }),
  }).then((value) => asRecord(value).removed === true);
