import { useCallback, useRef } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { AlertCircle, RotateCcw } from "lucide-react-native";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/store";
import { ActivityChip } from "./ActivityChip";
import { ReplyContent } from "./ReplyContent";

type Props = {
  message: ChatMessage;
  replyTarget?: ChatMessage;
  onRetry?: (id: string) => void;
  onFocusLost?: () => void;
  retryDisabled?: boolean;
  grouped?: boolean;
  reducedMotion?: boolean;
  onExpandDetails?: () => void;
};

export function MessageBubble({ message, replyTarget, onRetry, onFocusLost, retryDisabled, grouped, reducedMotion, onExpandDetails }: Props) {
  const retryRef = useRef<View | null>(null);
  const setRetryRef = useCallback((node: View | null) => {
    // A retry or a late receipt removes this control. Keep keyboard navigation
    // in the transcript when it owns focus, without moving other readers.
    if (!node && Platform.OS === "web" && retryRef.current &&
      document.activeElement === (retryRef.current as unknown as HTMLElement)) onFocusLost?.();
    retryRef.current = node;
  }, [onFocusLost]);
  if (message.kind === "activity" && message.tool) return <ActivityChip tool={message.tool} reducedMotion={reducedMotion} onExpand={onExpandDetails} />;
  if (message.kind === "system") return <View className="my-2 min-w-0 items-center"><Text testID="message-text"
    className="max-w-full text-[12px] text-ink-secondary" selectable>{message.text}</Text></View>;
  const user = message.role === "user";
  const label = user
    ? message.failed ? "Your message failed to send" : message.pending ? "Sending your message" : "Your message"
    : message.streaming ? "Assistant is replying" : message.interrupted ? "Assistant reply stopped" : "Assistant message";
  return (
    <View testID={`message-${message.id}`} className={cn("w-full flex-row", user ? "justify-end" : "justify-start", grouped ? "mb-1" : "mb-4")}>
      <View className={cn("min-w-0 max-w-[90%]", user ? "items-end" : "items-start")}>
        <View accessibilityLabel={label} aria-busy={!!message.streaming} accessibilityState={{ busy: !!message.streaming }} className={cn(
          "min-w-0 max-w-full rounded-2xl px-4 py-2.5",
          user ? "rounded-br-md bg-bubble-user" : "rounded-bl-md bg-card",
          message.failed && "border border-danger/60",
        )}>
          <ReplyContent message={message} replyTarget={replyTarget} onFocusLost={onFocusLost} />
        </View>
        {!grouped || message.streaming || message.interrupted || message.pending ? (
          <Text className="mt-1.5 px-1 text-[11px] text-ink-secondary">
            {message.streaming ? "Replying…" : message.interrupted ? "Stopped" : message.pending ? "Sending…" : `${user ? "You · " : ""}${formatTime(message.createdAt)}`}
          </Text>
        ) : null}
        {message.failed ? (
          <Pressable ref={setRetryRef} onPress={() => onRetry?.(message.id)} disabled={retryDisabled || !onRetry}
            accessibilityRole="button" accessibilityLabel="Retry failed message"
            accessibilityState={{ disabled: retryDisabled || !onRetry }}
            className="mt-1 min-h-11 flex-row items-center gap-1.5 rounded-lg px-2 py-2 active:bg-raised">
            <AlertCircle size={14} color="#ff5667" />
            <Text className="text-[12px] text-danger">Send failed · Retry</Text>
            <RotateCcw size={12} color="#ff5667" />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
