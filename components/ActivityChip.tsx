import { ActivityIndicator, Text, View } from "react-native";
import { Check, X } from "lucide-react-native";
import type { ToolActivity } from "@/lib/types";
import { cn } from "@/lib/cn";

/** Grok-style tool activity chip: spinner while running, check / x when settled. */
export function ActivityChip({ tool }: { tool: ToolActivity }) {
  const failed = tool.ok === false;
  const running = tool.ok === undefined;
  const status = running ? "running" : failed ? "failed" : "done";
  return (
    <View className="mb-2 flex-row justify-start pl-1">
      <View
        accessibilityRole="text"
        accessibilityLabel={`Tool ${tool.name} ${status}${tool.detail ? `, ${tool.detail}` : ""}`}
        className={cn(
          "flex-row items-center gap-2 rounded-full border border-hairline bg-panel px-3 py-1.5",
          running && "border-accent-border/40",
          failed && "border-danger/50 bg-danger/10",
        )}
      >
        {running ? (
          <ActivityIndicator size="small" color="#fcfcfc99" />
        ) : failed ? (
          <X size={13} color="#ff5667" />
        ) : (
          <Check size={13} color="#38d591" />
        )}
        <Text
          className={cn("font-mono text-[13px]", failed ? "text-danger" : "text-ink")}
          numberOfLines={1}
        >
          {tool.name}
        </Text>
        {tool.detail ? (
          <Text
            className={cn("max-w-[220px] text-[12px]", failed ? "text-danger/80" : "text-ink-secondary")}
            numberOfLines={1}
          >
            {tool.detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
