import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { parseInlineMarkdown, parseMarkdown, type MarkdownTable, type MarkdownTask } from "@/lib/markdown";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/clipboard";
import { ExternalLink } from "./ExternalLink";

/** Small, selectable Markdown subset. HTML is always displayed as text. */
export function RichText({ text, streaming, raw = false, onFocusLost }: {
  text: string; streaming?: boolean; raw?: boolean; onFocusLost?: () => void;
}) {
  if (raw) return <Text testID="message-text" className="text-[15px] leading-[22px] text-ink" selectable>
    {text}{streaming ? <StreamingCursor /> : null}
  </Text>;
  const nodes = parseMarkdown(text);
  const last = nodes.length - 1;
  return (
    <View className="min-w-0 max-w-full">
      {nodes.map((node, index) => {
        const current = index === last;
        if (node.type === "code") return <CodeBlock key={index} text={node.text} language={node.language} streaming={!!streaming && current} />;
        if (node.type === "table") return <MarkdownTableView key={index} table={node.table} onFocusLost={onFocusLost} />;
        if (node.type === "tasks") return <TaskList key={index} items={node.items} onFocusLost={onFocusLost} />;
        return (
          <Text key={index} testID="message-text" className="text-[15px] leading-[22px] text-ink" selectable>
            {renderInline(node.text, !!streaming && current, onFocusLost)}
            {streaming && current ? <StreamingCursor /> : null}
          </Text>
        );
      })}
      {streaming && (nodes.at(-1)?.type === "table" || nodes.at(-1)?.type === "tasks") ? <StreamingCursor /> : null}
    </View>
  );
}

function StreamingCursor() {
  return <Text aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="text-accent-border">▍</Text>;
}

function CodeBlock({ text, language, streaming }: { text: string; language?: string; streaming: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <View className="my-2 max-w-full rounded-xl border border-hairline bg-inset p-3">
      <View className="mb-1 flex-row items-center gap-3">
        {language ? <Text className="text-[11px] text-ink-secondary">{language}</Text> : null}
        <Pressable onPress={() => void copyText(text).then(() => setCopied(true))}
          accessibilityRole="button" accessibilityLabel="Copy code"
          className="ml-auto min-h-9 justify-center active:opacity-70">
          <Text className="text-[11px] text-ink-secondary">{copied ? "Copied" : "Copy code"}</Text>
        </Pressable>
      </View>
      <Text testID="message-text" className="font-mono text-[13px] leading-5 text-ink" selectable>{text}</Text>
      {streaming ? <StreamingCursor /> : null}
    </View>
  );
}

function MarkdownTableView({ table, onFocusLost }: { table: MarkdownTable; onFocusLost?: () => void }) {
  const widths = table.headers.map((_, column) => {
    let longest = table.headers[column]?.length ?? 0;
    for (const row of table.rows) longest = Math.max(longest, (row[column] ?? "").length);
    return Math.min(280, Math.max(96, longest * 8 + 24));
  });
  return (
    <ScrollView horizontal className="my-2 max-w-full" accessibilityLabel="Table"
      role={Platform.OS === "web" ? "region" : undefined} tabIndex={Platform.OS === "web" ? 0 : undefined}>
      <View role={Platform.OS === "web" ? "table" : undefined}>
        <View role={Platform.OS === "web" ? "row" : undefined} className="flex-row border-b border-hairline">
          {table.headers.map((header, column) => (
            <Text key={column} role={Platform.OS === "web" ? "columnheader" : undefined}
              style={{ width: widths[column], textAlign: table.align[column] }}
              className="p-2 text-[13px] font-semibold leading-5 text-ink">
              {renderInline(header, false, onFocusLost)}
            </Text>
          ))}
        </View>
        {table.rows.map((row, index) => (
          <View key={index} role={Platform.OS === "web" ? "row" : undefined} className="flex-row">
            {table.headers.map((_, column) => (
              <Text testID="message-text" key={column} role={Platform.OS === "web" ? "cell" : undefined}
                style={{ width: widths[column], textAlign: table.align[column] }}
                className="p-2 text-[13px] leading-5 text-ink" selectable>
                {renderInline(row[column] ?? "", false, onFocusLost)}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function TaskList({ items, onFocusLost }: { items: MarkdownTask[]; onFocusLost?: () => void }) {
  return (
    <View className="min-w-0 max-w-full">
      {items.map((item, index) => <TaskItem key={index} item={item} onFocusLost={onFocusLost} />)}
    </View>
  );
}

function TaskItem({ item, onFocusLost }: { item: MarkdownTask; onFocusLost?: () => void }) {
  const [checked, setChecked] = useState(item.checked);
  return (
    <View className="min-h-11 flex-row items-start gap-2.5 py-0.5">
      <Pressable onPress={() => setChecked((value) => !value)} accessibilityRole="checkbox"
        accessibilityState={{ checked }} accessibilityLabel={item.text || "Task"}
        className="min-h-11 w-6 items-center justify-center active:opacity-80">
        <View aria-hidden className={cn("h-4 w-4 items-center justify-center rounded-[4px] border",
          checked ? "border-ink bg-ink" : "border-ink-secondary")}>
          {checked ? <Check size={12} color="#070707" /> : null}
        </View>
      </Pressable>
      <Text className={cn("min-w-0 flex-1 pt-2.5 text-[15px] leading-[22px]", checked ? "text-ink-secondary line-through" : "text-ink")}>
        {renderInline(item.text, false, onFocusLost)}
      </Text>
    </View>
  );
}

function renderInline(text: string, streaming = false, onFocusLost?: () => void) {
  let lineStart = true;
  return parseInlineMarkdown(text, streaming).map((span, index) => {
    // Convert list markers only in plain text, after code spans have been
    // identified across soft breaks. A span boundary is not a new source line.
    const plain = span.kind === "text" ? span.text.replace(/(^|\n)[-*] /g,
      (match, prefix: string) => prefix || lineStart ? `${prefix}• ` : match) : span.text;
    if (span.text) lineStart = span.kind === "text" && span.text.endsWith("\n");
    if (span.kind === "strong") return <Text key={index} className="font-semibold">{span.text}</Text>;
    if (span.kind === "code") return <Text key={index} className="bg-inset font-mono text-[13px] text-ink">{span.text}</Text>;
    if (span.kind === "link") return <ExternalLink key={index} label={span.text} url={span.url} onFocusLost={onFocusLost} />;
    return <Text key={index}>{plain}</Text>;
  });
}
