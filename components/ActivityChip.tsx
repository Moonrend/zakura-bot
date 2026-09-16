import { useId, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { Check, ChevronDown, ChevronUp, Square, Wrench, X } from "lucide-react-native";
import type { ToolActivity } from "@/lib/types";
import { cn } from "@/lib/cn";

export function ActivityChip({ tool, reducedMotion = false }: { tool: ToolActivity; reducedMotion?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const stopped = !!tool.interrupted;
  const failed = !stopped && tool.ok === false;
  const running = !stopped && tool.ok === undefined;
  const status = stopped ? "Stopped" : running ? "Running" : failed ? "Failed" : "Done";
  const icon = stopped ? <Square size={12} color="#b3b3b3" />
    : failed ? <X size={14} color="#ff5667" />
      : running ? reducedMotion ? <Wrench size={14} color="#b3b3b3" /> : <ActivityIndicator size="small" color="#b3b3b3" />
        : <Check size={14} color="#38d591" />;

  return (
    <View className="mb-2 max-w-full items-start">
      <Pressable onPress={() => setExpanded((value) => !value)} disabled={!tool.detail}
        accessibilityRole={tool.detail ? "button" : "text"}
        accessibilityLabel={`Tool ${tool.name}, ${status}`}
        {...(Platform.OS === "web" ? { "aria-expanded": tool.detail ? expanded : undefined,
          "aria-controls": expanded && tool.detail ? detailId : undefined } : { accessibilityState: tool.detail ? { expanded } : undefined })}
        className={cn("max-w-full rounded-2xl border border-hairline bg-panel px-3 py-2.5",
          running && "border-accent-border/50", failed && "border-danger/50 bg-danger/10")}>
        <View className="min-h-6 max-w-full flex-row items-center gap-2">
          {icon}
          <Text className={cn("min-w-0 shrink font-mono text-[12px]", failed ? "text-danger" : "text-ink")} numberOfLines={1}>{tool.name}</Text>
          <Text className={cn("shrink-0 text-[11px]", failed ? "text-danger" : "text-ink-secondary")}>{status}</Text>
          {tool.detail ? expanded ? <ChevronUp size={14} color="#b3b3b3" /> : <ChevronDown size={14} color="#b3b3b3" /> : null}
        </View>
      </Pressable>
      {expanded && tool.detail ? <Text nativeID={detailId} testID="message-text"
        className="mt-2 max-w-full px-3 text-[12px] leading-5 text-ink-secondary" selectable>{tool.detail}</Text> : null}
    </View>
  );
}
