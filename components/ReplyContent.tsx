import { Platform, ScrollView, Text, View } from "react-native";
import { Paperclip } from "lucide-react-native";
import type { ChatMessage } from "@/lib/types";
import { ExternalLink } from "./ExternalLink";
import { RichText } from "./RichText";

function filename(url: string): string {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "") || "Attachment"; }
  catch { return "Attachment"; }
}

/** Received files are links. Uploads and embedded media playback are not implemented. */
export function ReplyContent({ message, replyTarget }: { message: ChatMessage; replyTarget?: ChatMessage }) {
  const card = message.card;
  // Media and URL buttons are rendered below. A card containing only those
  // links (or body text already shown above) does not need an empty body panel.
  const hasCardBody = card && (card.title?.trim() || card.subtitle?.trim() ||
    (card.text !== message.text && card.text?.trim()) || card.fields?.some((field) => field.label.trim() || field.value.trim()) ||
    card.table?.headers.some((cell) => cell.trim()) || card.table?.rows.some((row) => row.some((cell) => cell.trim())));
  const links = [...(message.actions ?? []), ...(card?.links ?? [])];
  const images = [...(card?.images ?? []), ...(card?.imageUrl ? [{ url: card.imageUrl, alt: "Card image" }] : [])];
  const quote = replyTarget?.text?.trim() || replyTarget?.card?.title || replyTarget?.attachments?.[0]?.name || "Earlier message";
  const hasText = !!message.text?.trim();
  const empty = !hasText && !card && !message.attachments?.length && !links.length;
  return (
    <View testID="reply-content" className="min-w-0 max-w-full gap-2">
      {message.replyTo ? <View className="mb-1 max-w-full gap-1 border-l-2 border-accent-border pl-2">
        <Text className="text-[11px] font-semibold text-ink-secondary">{replyTarget ? replyTarget.role === "user" ? "Reply to you" : "Reply to agent" : "Reply to earlier message"}</Text>
        {replyTarget ? <Text className="text-[12px] text-ink-secondary" numberOfLines={2}>{quote}</Text> : null}
      </View> : null}
      {hasText || message.streaming ? <RichText text={hasText ? message.text! : ""} streaming={message.streaming} raw={message.role === "user" || message.format === "raw"} /> : null}
      {empty && !message.streaming ? <Text className="text-[13px] leading-5 text-ink-secondary">
        {message.interrupted ? "Reply stopped before any text arrived." : "No reply content was received."}
      </Text> : null}
      {card && hasCardBody ? (
        <View className="min-w-0 max-w-full gap-2 rounded-xl border border-hairline bg-inset p-3">
          {card.title?.trim() ? <Text className="text-[15px] font-semibold text-ink" selectable>{card.title}</Text> : null}
          {card.subtitle?.trim() ? <Text className="text-[12px] text-ink-secondary" selectable>{card.subtitle}</Text> : null}
          {card.text?.trim() && card.text !== message.text ? <RichText text={card.text} /> : null}
          {card.fields?.map((field, index) => <View key={index} className="gap-1">
            <Text className="text-[11px] text-ink-secondary">{field.label}</Text>
            <Text testID="message-text" className="text-[13px] text-ink" selectable>{field.value}</Text>
          </View>)}
          {card.table ? <ScrollView horizontal className="max-w-full" accessibilityLabel="Card table"
            role={Platform.OS === "web" ? "region" : undefined} tabIndex={Platform.OS === "web" ? 0 : undefined}>
            <View role={Platform.OS === "web" ? "table" : undefined} accessibilityLabel="Reply table">
              {card.table.headers.length ? <View role={Platform.OS === "web" ? "row" : undefined} className="flex-row border-b border-hairline">
                {card.table.headers.map((header, index) => <Text key={index} role={Platform.OS === "web" ? "columnheader" : undefined}
                  className="w-36 p-2 text-[12px] font-semibold text-ink">{header}</Text>)}
              </View> : null}
              {card.table.rows.map((row, index) => <View key={index} role={Platform.OS === "web" ? "row" : undefined} className="flex-row">
                {(row.length ? row : [""]).map((cell, cellIndex) => <Text testID="message-text" key={cellIndex} role={Platform.OS === "web" ? "cell" : undefined}
                  className="w-36 p-2 text-[12px] text-ink" selectable>{cell}</Text>)}
              </View>)}
            </View>
          </ScrollView> : null}
        </View>
      ) : null}
      {message.attachments?.map((file, index) => (
        <ExternalLink key={index} url={file.url} label={file.name || filename(file.url)} buttonStyle="default"
          icon={<Paperclip size={15} color="#b3b3b3" />} />
      ))}
      {images.map((item, index) => <ExternalLink key={`image_${index}`} url={item.url} label={item.alt || "Open image"} buttonStyle="default" />)}
      {links.map((link, index) => <ExternalLink key={`link_${index}`} url={link.url} label={link.label} buttonStyle={link.style ?? "default"} />)}
    </View>
  );
}
