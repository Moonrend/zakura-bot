import { ActivityIndicator, Text, View } from "react-native";
import type { ToolActivity } from "@/lib/types";

export function ActivityChip({ tool, reducedMotion = false }: {
  tool: ToolActivity; reducedMotion?: boolean;
}) {
  if (tool.interrupted || tool.ok !== undefined) return null;

  // chat_reply and other channel tools never surface their names — only generic verbs.
  const label = /search/i.test(tool.name) ? "Searching…"
    : /code|shell|exec|terminal|bash|python|command|write_stdin/i.test(tool.name) ? "Running code…"
    : "Working…";

  return (
    <View testID="tool-activity" accessible accessibilityLabel={label}
      className="mb-2 max-w-full flex-row items-center gap-1.5 self-start rounded-full bg-panel px-2.5 py-1">
      {reducedMotion ? <View className="h-1.5 w-1.5 rounded-full bg-ink-secondary" />
        : <ActivityIndicator size="small" color="#b3b3b3" style={{ width: 12, height: 12, transform: [{ scale: 0.65 }] }} />}
      <Text className="text-[11px] leading-4 text-ink-secondary">{label}</Text>
    </View>
  );
}
