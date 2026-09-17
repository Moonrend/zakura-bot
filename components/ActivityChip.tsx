import { useId, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { Check, ChevronDown, ChevronUp, Square, Wrench, X } from "lucide-react-native";
import type { ToolActivity } from "@/lib/types";
import { cn } from "@/lib/cn";
import { useFocusOnRemoval } from "@/lib/use-focus-on-removal";

export function ActivityChip({ tool, reducedMotion = false, onExpand, onFocusLost }: {
  tool: ToolActivity; reducedMotion?: boolean; onExpand?: () => void; onFocusLost?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const setRef = useFocusOnRemoval(onFocusLost);
  const hasDetail = !!tool.detail?.trim();
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
      <Pressable ref={setRef} onPress={() => {
        if (!expanded) onExpand?.();
        setExpanded((value) => !value);
      }} disabled={!hasDetail}
        accessibilityRole={hasDetail ? "button" : "text"}
        accessibilityLabel={`Tool ${tool.name}, ${status}`}
        {...(Platform.OS === "web" ? { "aria-expanded": hasDetail ? expanded : undefined,
          "aria-controls": expanded && hasDetail ? detailId : undefined } : { accessibilityState: hasDetail ? { expanded } : undefined })}
        className={cn("max-w-full rounded-2xl border border-hairline bg-panel px-3 py-2.5",
          running && "border-accent-border/50", failed && "border-danger/50 bg-danger/10")}>
        <View className="min-h-6 max-w-full flex-row items-center gap-2">
          {icon}
          <Text className={cn("min-w-0 shrink font-mono text-[12px]", failed ? "text-danger" : "text-ink")} numberOfLines={1}>{tool.name}</Text>
          <Text className={cn("shrink-0 text-[11px]", failed ? "text-danger" : "text-ink-secondary")}>{status}</Text>
          {hasDetail ? expanded ? <ChevronUp size={14} color="#b3b3b3" /> : <ChevronDown size={14} color="#b3b3b3" /> : null}
        </View>
      </Pressable>
      {expanded && hasDetail ? <Text nativeID={detailId} testID="message-text"
        className="mt-2 max-w-full px-3 text-[12px] leading-5 text-ink-secondary" selectable>{tool.detail}</Text> : null}
    </View>
  );
}
