import { ActivityIndicator, Text, View } from "react-native";
import type { Agent, ToolActivity } from "@/lib/types";
import { BlobAvatar } from "./BlobAvatar";

export function ActivityChip({ tool, reducedMotion = false, agent }: {
  tool: ToolActivity; reducedMotion?: boolean; agent?: Pick<Agent, "name" | "color">;
}) {
  if (tool.interrupted || tool.ok !== undefined) return null;

  // chat_reply and other channel tools never surface their names — only generic verbs.
  const label = /search/i.test(tool.name) ? "Searching…"
    : /code|shell|exec|terminal|bash|python|command|write_stdin/i.test(tool.name) ? "Running code…"
    : "Working…";

  // Grok Bot shows the bot's avatar beside a short status line; the avatar
  // sits outside the labelled pill so the status text stays exactly the verb.
  return (
    <View className="mb-2 max-w-full flex-row items-center gap-2.5 self-start">
      {agent ? <BlobAvatar color={agent.color} name={agent.name} size={28} /> : null}
      <View testID="tool-activity" accessible accessibilityLabel={label}
        className="flex-row items-center gap-1.5 rounded-full py-1">
        {reducedMotion ? <View className="h-1.5 w-1.5 rounded-full bg-ink-secondary" />
          : <ActivityIndicator size="small" color="#b3b3b3" style={{ width: 12, height: 12, transform: [{ scale: 0.65 }] }} />}
        <Text className="text-[14px] leading-5 text-ink-secondary">{label}</Text>
      </View>
    </View>
  );
}
