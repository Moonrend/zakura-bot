import { ActivityIndicator, Text, View } from "react-native";
import { Check, X } from "lucide-react-native";
import type { ToolActivity } from "@/lib/types";
import { cn } from "@/lib/cn";

export function ActivityChip({ tool }: { tool: ToolActivity }) {
  const failed = tool.ok === false;
  const running = tool.ok === undefined;
  return (
    <View className="mb-2 flex-row justify-start">
      <View
        className={cn(
          "flex-row items-center gap-2 rounded-full border border-hairline bg-panel px-3 py-1.5",
          failed && "border-danger/40",
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
          className={cn(
            "max-w-[280px] font-mono text-[13px]",
            failed ? "text-danger" : "text-ink-secondary",
          )}
          numberOfLines={1}
        >
          {tool.name}
          {tool.detail ? ` · ${tool.detail}` : ""}
        </Text>
      </View>
    </View>
  );
}
