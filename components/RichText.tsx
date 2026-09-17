import { Text, View } from "react-native";
import { ExternalLink } from "./ExternalLink";

/** Small, selectable Markdown subset. HTML is always displayed as text. */
export function RichText({ text, streaming, raw = false }: { text: string; streaming?: boolean; raw?: boolean }) {
  if (raw) return <Text testID="message-text" className="text-[15px] leading-[22px] text-ink" selectable>
    {text}{streaming ? <StreamingCursor /> : null}
  </Text>;
  const blocks: { code: boolean; text: string; language?: string }[] = [];
  const fences = /```([^\n`]*)\n([\s\S]*?)(?:```|$)/g;
  let offset = 0;
  for (const match of text.matchAll(fences)) {
    if (match.index > offset) blocks.push({ code: false, text: text.slice(offset, match.index) });
    blocks.push({ code: true, text: match[2], language: match[1].trim() });
    offset = match.index + match[0].length;
  }
  if (offset < text.length || blocks.length === 0) blocks.push({ code: false, text: text.slice(offset) });
  return (
    <View className="min-w-0 max-w-full">
      {blocks.map((block, index) => block.code ? (
        <View key={index} className="my-2 max-w-full rounded-xl border border-hairline bg-inset p-3">
          {block.language ? <Text className="mb-2 text-[11px] text-ink-secondary">{block.language}</Text> : null}
          <Text testID="message-text" className="font-mono text-[13px] leading-5 text-ink" selectable>{block.text.replace(/\n$/, "")}</Text>
        </View>
      ) : (
        <Text key={index} testID="message-text" className="text-[15px] leading-[22px] text-ink" selectable>
          {block.text.split("\n").map((line, lineIndex) => (
            <Text key={lineIndex}>{lineIndex ? "\n" : null}{renderInline(line.replace(/^[-*] /, "• "))}</Text>
          ))}
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

const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
function renderInline(line: string) {
  return line.split(TOKEN).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <Text key={index} className="font-semibold">{part.slice(2, -2)}</Text>;
    if (part.startsWith("`") && part.endsWith("`")) return <Text key={index} className="bg-inset font-mono text-[13px] text-ink">{part.slice(1, -1)}</Text>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
    if (link) return <ExternalLink key={index} label={link[1]} url={link[2]} />;
    return <Text key={index}>{part}</Text>;
  });
}
