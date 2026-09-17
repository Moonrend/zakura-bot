import type { ChatMessage, MessageAttachment } from "./types";

/** Use the same label for a received file and summaries that refer to it. */
export function attachmentLabel(attachment: MessageAttachment): string {
  if (attachment.name?.trim()) return attachment.name.trim();
  try { return decodeURIComponent(new URL(attachment.url).pathname.split("/").pop() ?? "").trim() || "Attachment"; }
  catch { return "Attachment"; }
}

/** Plain text shared by quotes, sidebar previews and reply announcements. */
export function messageContentPreview(message: ChatMessage): string | undefined {
  if (message.kind === "activity") return undefined;
  const text = message.interaction?.title?.trim() || message.text?.trim() || message.card?.title?.trim() || message.card?.text?.trim() || message.card?.subtitle?.trim() ||
    (message.attachments?.length ? attachmentLabel(message.attachments[0]) : undefined) ||
    message.actions?.[0]?.label || message.card?.links?.[0]?.label || (message.card ? "Card" : undefined);
  return text?.replace(/\s+/g, " ");
}
