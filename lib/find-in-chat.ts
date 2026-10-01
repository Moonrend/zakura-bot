import type { ChatMessage } from "./types";

/** One match step; repeated message ids represent several occurrences in one bubble. */
export type FindMatch = { messageId: string };

/** Visible transcript text a query can match against. */
export function searchableText(message: ChatMessage): string {
  const parts: string[] = [];
  if (message.text) parts.push(message.text);
  for (const attachment of message.attachments ?? []) if (attachment.name) parts.push(attachment.name);
  return parts.join("\n");
}

function countOccurrences(haystack: string, needle: string): number {
  const hay = haystack.toLowerCase();
  const pin = needle.toLowerCase();
  let count = 0;
  let index = hay.indexOf(pin);
  while (index !== -1) {
    count++;
    index = hay.indexOf(pin, index + pin.length);
  }
  return count;
}

/**
 * Case-insensitive substring matches over the loaded transcript, ordered by message and
 * position. A message with several occurrences contributes one entry per occurrence so
 * counts reflect occurrences while navigation still resolves to whole messages.
 */
export function findMatches(messages: ChatMessage[], query: string): FindMatch[] {
  if (!query) return [];
  const matches: FindMatch[] = [];
  for (const message of messages) {
    const count = countOccurrences(searchableText(message), query);
    for (let i = 0; i < count; i++) matches.push({ messageId: message.id });
  }
  return matches;
}
