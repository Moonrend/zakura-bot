import { Text, View } from "react-native";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/cn";
import { ActivityChip } from "./ActivityChip";

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.kind === "activity" && message.tool) {
    return <ActivityChip tool={message.tool} />;
  }

  if (message.kind === "system") {
    return (
      <View className="my-2 items-center">
        <Text className="text-[12px] text-ink-secondary">{message.text}</Text>
      </View>
    );
  }

  const user = message.role === "user";
  return (
    <View className={cn("mb-2 w-full flex-row", user ? "justify-end" : "justify-start")}>
      <View
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5",
          user ? "bg-bubble-user" : "bg-card",
        )}
      >
        <Text className="text-[15px] leading-relaxed text-ink">
          {message.text}
          {message.streaming ? (
            <Text className="text-ink-secondary">▍</Text>
          ) : null}
        </Text>
      </View>
    </View>
  );
}
