import { Pressable, Text, View } from "react-native";
import { RotateCcw } from "lucide-react-native";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/cn";
import { useFocusOnRemoval } from "@/lib/use-focus-on-removal";
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
};

export function MessageBubble({ message, replyTarget, onRetry, onFocusLost, retryDisabled, grouped, reducedMotion }: Props) {
  const setRetryRef = useFocusOnRemoval(onFocusLost);
  if (message.kind === "activity") return message.tool
    ? <ActivityChip tool={message.tool} reducedMotion={reducedMotion} /> : null;
  if (message.kind === "system") return <View className="my-2 min-w-0 items-center"><Text testID="message-text"
    className="max-w-full text-[12px] text-ink-secondary" selectable>{message.text}</Text></View>;
  const user = message.role === "user";
  const label = user
    ? message.failed ? "Your message failed to send" : message.pending ? "Sending your message" : "Your message"
    : message.streaming ? "Assistant is replying" : message.interrupted ? "Assistant reply stopped" : "Assistant message";
  return (
    <View testID={`message-${message.id}`} className={cn("w-full flex-row", user ? "justify-end" : "justify-start", grouped ? "mb-1.5" : "mb-3")}>
      <View className={cn("min-w-0 max-w-[90%]", user ? "items-end" : "items-start")}>
        <View accessibilityLabel={label} aria-busy={!!message.streaming} accessibilityState={{ busy: !!message.streaming }} className={cn(
          "min-w-0 max-w-full rounded-[22px] px-4 py-3",
          user ? "bg-bubble-user" : "bg-card",
          message.failed && "border border-danger/60",
        )}>
          <ReplyContent message={message} replyTarget={replyTarget} onFocusLost={onFocusLost} />
        </View>
        {!message.streaming && (message.interrupted || message.pending) ? (
          <Text className="mt-1 px-1 text-[12px] text-ink-secondary">{message.interrupted ? "Stopped" : "Sending…"}</Text>
        ) : null}
        {message.failed ? (
          <Pressable ref={setRetryRef} onPress={() => onRetry?.(message.id)} disabled={retryDisabled || !onRetry}
            accessibilityRole="button" accessibilityLabel="Retry failed message"
            accessibilityState={{ disabled: retryDisabled || !onRetry }}
            className="mt-1 min-h-11 flex-row items-center gap-1.5 rounded-lg px-2 py-2 active:bg-raised">
            <RotateCcw size={12} color="#ff5667" />
            <Text className="text-[12px] text-danger">Retry</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
