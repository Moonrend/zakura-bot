import { Pressable, Text, View } from "react-native";
import { AlertCircle, RotateCcw } from "lucide-react-native";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/store";
import { ActivityChip } from "./ActivityChip";
import { RichText } from "./RichText";

type Props = {
  message: ChatMessage;
  /** Retry handler for failed user messages. */
  onRetry?: (id: string) => void;
  /** Whether the next message is from the same author (tightens spacing). */
  grouped?: boolean;
};

export function MessageBubble({ message, onRetry, grouped }: Props) {
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
  const label = `${user ? "You" : "Assistant"} at ${formatTime(message.createdAt)}: ${message.text ?? ""}`;

  return (
    <View
      className={cn("w-full flex-row", user ? "justify-end" : "justify-start", grouped ? "mb-1" : "mb-3")}
    >
      <View className={cn("max-w-[85%]", user ? "items-end" : "items-start")}>
        <View
          accessibilityRole="text"
          accessibilityLabel={label}
          className={cn(
            "rounded-2xl px-4 py-2.5",
            user ? "rounded-br-md bg-bubble-user" : "rounded-bl-md bg-card",
            message.failed && "border border-danger/60",
          )}
        >
          <RichText text={message.text ?? ""} streaming={message.streaming} />
        </View>
        {message.interrupted ? (
          <Text className="mt-1 px-1 text-[11px] text-ink-secondary">Stopped</Text>
        ) : null}
        {message.failed ? (
          <Pressable
            onPress={() => onRetry?.(message.id)}
            accessibilityRole="button"
            accessibilityLabel="Message failed to send. Tap to retry."
            className="mt-1 flex-row items-center gap-1 px-1 py-0.5 active:opacity-70"
          >
            <AlertCircle size={12} color="#ff5667" />
            <Text className="text-[11px] text-danger">Not sent · Retry</Text>
            <RotateCcw size={11} color="#ff5667" />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
