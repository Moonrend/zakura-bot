import type { ChatMessage, InteractionAnswer, MessageInteraction } from "./types";
import { decodeInteraction, isChannelId } from "./channel/protocol";

export const interactionPath = (agentId: string, messageId?: string) =>
  `/api/zakurabot/agents/${encodeURIComponent(agentId)}/interactions${messageId ? `/${encodeURIComponent(messageId)}` : ""}`;

export function interactionPending(interaction: MessageInteraction, now = Date.now()): boolean {
  return interaction.status === "pending" && (!interaction.expiresAt || Date.parse(interaction.expiresAt) > now);
}

export function interactionStatus(interaction: MessageInteraction, now = Date.now()): string {
  if (interaction.status === "pending") return interactionPending(interaction, now) ? "Waiting for your response" : "Expired";
  return { answered: "Answered", cancelled: "Cancelled", skipped: "Skipped", timeout: "Expired", resolved: "Completed" }[interaction.status];
}

/** Answers never become user messages or drafts. Only request metadata is replayed. */
export function prepareInteractionAnswer(interaction: MessageInteraction, answer: InteractionAnswer): InteractionAnswer {
  if (!interactionPending(interaction)) throw new Error("This request has ended.");
  if (answer.cancelled) return { cancelled: true };
  const options = new Set(interaction.options?.map((option) => option.id));
  if (interaction.type === "approval") {
    if (!answer.optionId || !options.has(answer.optionId)) throw new Error("Choose one of the offered approval options.");
    return { optionId: answer.optionId };
  }
  if (interaction.type === "question") {
    const selected = answer.selected ?? [];
    if (selected.some((id) => !options.has(id)) || new Set(selected).size !== selected.length ||
      (!interaction.allowMultiple && selected.length > 1)) throw new Error("Choose from the offered options.");
    const text = answer.text ?? "";
    if (text.length > 8000) throw new Error("Answers can contain up to 8,000 characters.");
    if (!selected.length && !text.trim()) throw new Error("Choose an option or enter an answer.");
    // Preserve whitespace in secret values such as credentials.
    return { ...(selected.length ? { selected } : {}), ...(text.trim() ? { text: interaction.secret ? text : text.trim() } : {}) };
  }
  const fields = interaction.fields ?? [];
  const content = answer.content ?? {};
  if (Object.keys(content).some((key) => !fields.some((field) => field.id === key))) throw new Error("The form has changed. Check its fields.");
  for (const field of fields) {
    const value = content[field.id];
    if (value === undefined) {
      if (field.required) throw new Error(`Enter ${field.title || field.id}.`);
      continue;
    }
    const valid = field.type === "array" ? Array.isArray(value) && value.length <= 32 && value.every((item) => typeof item === "string" && item.length <= 2000)
      : field.type === "integer" ? Number.isSafeInteger(value)
      : field.type === "number" ? typeof value === "number" && Number.isFinite(value)
      : field.type === "boolean" ? typeof value === "boolean"
      : field.type === "string" && typeof value === "string" && value.length <= 8000;
    if (!valid) throw new Error(`Check the value for ${field.title || field.id}.`);
    if (field.options?.length && (typeof value !== "string" || !field.options.includes(value))) throw new Error(`Choose an offered value for ${field.title || field.id}.`);
  }
  return { content };
}

export function parseInteractionSnapshot(agentId: string, value: unknown): ChatMessage {
  const item = value as Record<string, unknown> | null;
  if (!isChannelId(agentId) || !item || !isChannelId(item.messageId) || typeof item.createdAt !== "number" ||
    !Number.isFinite(item.createdAt) || item.createdAt < 0 || item.createdAt > 8.64e15 ||
    (item.replyTo !== undefined && !isChannelId(item.replyTo))) throw new Error("Zakura returned an invalid request.");
  return { id: item.messageId, agentId, role: "assistant", kind: "text", createdAt: item.createdAt,
    interaction: decodeInteraction(item.interaction), ...(item.replyTo ? { replyTo: item.replyTo as string } : {}) };
}

export type InteractionRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export async function fetchInteraction(request: InteractionRequest, agentId: string, messageId: string): Promise<ChatMessage> {
  const message = parseInteractionSnapshot(agentId, await request(interactionPath(agentId, messageId)));
  if (message.id !== messageId) throw new Error("Zakura returned a different request.");
  return message;
}

export async function submitInteraction(request: InteractionRequest, message: ChatMessage, answer: InteractionAnswer): Promise<ChatMessage> {
  if (!message.interaction) throw new Error("This message has no request.");
  const body = prepareInteractionAnswer(message.interaction, answer);
  let value: unknown;
  try {
    value = await request(interactionPath(message.agentId, message.id), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  } catch (error) {
    // A lost HTTP response may have succeeded. Read state before offering a retry;
    // never automatically repeat an approval or a secret answer.
    const latest = await fetchInteraction(request, message.agentId, message.id).catch(() => null);
    if (latest?.interaction?.status !== "pending" && latest) return latest;
    throw error;
  }
  const updated = parseInteractionSnapshot(message.agentId, value);
  if (updated.id !== message.id || updated.interaction?.requestId !== message.interaction.requestId || updated.interaction.status === "pending") {
    throw new Error("Zakura did not confirm the response. Refresh this request before retrying.");
  }
  return updated;
}
