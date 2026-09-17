import { Text, View } from "react-native";
import { parseInlineMarkdown, parseMarkdownBlocks } from "@/lib/markdown";
import { ExternalLink } from "./ExternalLink";

/** Small, selectable Markdown subset. HTML is always displayed as text. */
export function RichText({ text, streaming, raw = false }: { text: string; streaming?: boolean; raw?: boolean }) {
  if (raw) return <Text testID="message-text" className="text-[15px] leading-[22px] text-ink" selectable>
    {text}{streaming ? <StreamingCursor /> : null}
  </Text>;
  const blocks = parseMarkdownBlocks(text);
  return (
    <View className="min-w-0 max-w-full">
      {blocks.map((block, index) => block.code ? (
        <View key={index} className="my-2 max-w-full rounded-xl border border-hairline bg-inset p-3">
          {block.language ? <Text className="mb-2 text-[11px] text-ink-secondary">{block.language}</Text> : null}
          <Text testID="message-text" className="font-mono text-[13px] leading-5 text-ink" selectable>{block.text}</Text>
        </View>
      ) : (
        <Text key={index} testID="message-text" className="text-[15px] leading-[22px] text-ink" selectable>
          {renderInline(block.text, !!streaming && index === blocks.length - 1)}
          {streaming && index === blocks.length - 1 ? <StreamingCursor /> : null}
        </Text>
      ))}
      {streaming && blocks.at(-1)?.code ? <StreamingCursor /> : null}
    </View>
  );
}

function StreamingCursor() {
  return <Text aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="text-accent-border">▍</Text>;
}

function renderInline(text: string, streaming = false) {
  let lineStart = true;
  return parseInlineMarkdown(text, streaming).map((span, index) => {
    // Convert list markers only in plain text, after code spans have been
    // identified across soft breaks. A span boundary is not a new source line.
    const plain = span.kind === "text" ? span.text.replace(/(^|\n)[-*] /g,
      (match, prefix: string) => prefix || lineStart ? `${prefix}• ` : match) : span.text;
    if (span.text) lineStart = span.kind === "text" && span.text.endsWith("\n");
    if (span.kind === "strong") return <Text key={index} className="font-semibold">{span.text}</Text>;
    if (span.kind === "code") return <Text key={index} className="bg-inset font-mono text-[13px] text-ink">{span.text}</Text>;
    if (span.kind === "link") return <ExternalLink key={index} label={span.text} url={span.url} />;
    return <Text key={index}>{plain}</Text>;
  });
}
