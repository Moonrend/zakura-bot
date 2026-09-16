import { Text } from "react-native";
import { cn } from "@/lib/cn";

/**
 * Minimal inline Markdown renderer for chat bubbles: **bold**, `code`, and
 * simple "• " bullets. Full Markdown (chat_reply text is Markdown) can swap in
 * later without touching MessageBubble.
 */
export function RichText({ text, streaming }: { text: string; streaming?: boolean }) {
  const lines = text.split("\n");
  return (
    <Text className="text-[15px] leading-[22px] text-ink" selectable>
      {lines.map((line, li) => (
        <Text key={li}>
          {li > 0 ? "\n" : null}
          {renderInline(line)}
        </Text>
      ))}
      {streaming ? <Text className="text-accent">▍</Text> : null}
    </Text>
  );
}

const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`)/g;

function renderInline(line: string) {
  const parts = line.split(TOKEN).filter((p) => p.length > 0);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <Text key={i} className="font-semibold">
          {part.slice(2, -2)}
        </Text>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <Text key={i} className={cn("rounded bg-inset px-1 font-mono text-[13px] text-ink")}>
          {part.slice(1, -1)}
        </Text>
      );
    }
    return <Text key={i}>{part}</Text>;
  });
}
