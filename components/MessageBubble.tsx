import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { RotateCcw, SmilePlus } from "lucide-react-native";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/cn";
import { useFocusOnRemoval } from "@/lib/use-focus-on-removal";
import { useStore } from "@/lib/store";
import { MORE_REACTIONS, QUICK_REACTIONS, projectReactionPills, type ReactionPill } from "@/lib/reactions";
import { ActivityChip } from "./ActivityChip";
import { ReplyContent } from "./ReplyContent";

type Props = {
  message: ChatMessage;
  replyTarget?: ChatMessage;
  onRetry?: (id: string) => void;
  onDelete?: (id: string) => void;
  onFocusLost?: () => void;
  retryDisabled?: boolean;
  grouped?: boolean;
  reducedMotion?: boolean;
  highlight?: "current" | "match";
};

export function MessageBubble({ message, replyTarget, onRetry, onDelete, onFocusLost, retryDisabled, grouped, reducedMotion, highlight }: Props) {
  const setRetryRef = useFocusOnRemoval(onFocusLost);
  const { reactionsByAgent, currentUserId, toggleReaction } = useStore();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  if (message.kind === "activity") return message.tool
    ? <ActivityChip tool={message.tool} reducedMotion={reducedMotion} /> : null;
  if (message.kind === "system") return <View className={cn("my-2 min-w-0 items-center", highlight === "match" && "bg-raised/40", highlight === "current" && "bg-raised/60")}><Text testID="message-text"
    className="max-w-full text-[12px] text-ink-secondary" selectable>{message.text}</Text></View>;
  const user = message.role === "user";
  const label = user
    ? message.failed ? "Your message failed to send" : message.pending ? "Sending your message" : "Your message"
    : message.streaming ? "Assistant is replying" : message.interrupted ? "Assistant reply stopped" : "Assistant message";
  const canReact = !message.pending && !message.queued && !message.failed;
  const reactionKey = message.serverId ?? message.id;
  const byUser = reactionsByAgent[message.agentId]?.[reactionKey];
  const pills = projectReactionPills(byUser, currentUserId);
  const mine = currentUserId ? byUser?.[currentUserId] : undefined;
  const pick = (emoji: string) => {
    toggleReaction(message.agentId, reactionKey, emoji);
    setPickerOpen(false);
  };
  const bubble = (
    <View accessibilityLabel={label} aria-busy={!!message.streaming} accessibilityState={{ busy: !!message.streaming }} className={cn(
      "min-w-0 max-w-full rounded-[22px] px-4 py-3",
      highlight ? highlight === "current" ? "bg-raised/60" : "bg-raised/40" : user ? "bg-bubble-user" : "bg-card",
      message.failed && "border border-danger/60",
    )}>
      <ReplyContent message={message} replyTarget={replyTarget} onFocusLost={onFocusLost} />
    </View>
  );
  return (
    <View testID={`message-${message.id}`} className={cn("w-full flex-row", user ? "justify-end" : "justify-start", grouped ? "mb-1.5" : "mb-3")}>
      <View className={cn("relative min-w-0 max-w-[90%]", user ? "items-end" : "items-start")}
        {...(Platform.OS === "web" ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) } : {})}>
        {Platform.OS === "web" ? bubble
          : canReact ? <Pressable onLongPress={() => setPickerOpen(true)} delayLongPress={350} accessible={false}>{bubble}</Pressable>
          : bubble}
        {Platform.OS === "web" && canReact && (hovered || pickerOpen) ? (
          <Pressable onPress={() => setPickerOpen((open) => !open)} accessibilityRole="button"
            accessibilityLabel={pickerOpen ? "Close reaction picker" : "Add reaction"} accessibilityState={{ expanded: pickerOpen }}
            className={cn("absolute -top-2.5 z-10 h-7 w-7 items-center justify-center rounded-full border border-hairline bg-raised active:bg-raised-hover",
              user ? "-left-2.5" : "-right-2.5")}>
            <SmilePlus size={14} color="#b3b3b3" />
          </Pressable>
        ) : null}
        {!message.streaming && (message.interrupted || message.pending) ? (
          <Text className="mt-1 px-1 text-[12px] text-ink-secondary">{message.interrupted ? "Stopped" : "Sending…"}</Text>
        ) : null}
        {canReact && pills.length ? <ReactionPills testID={`reaction-pills-${message.id}`} pills={pills}
          onToggle={(emoji) => toggleReaction(message.agentId, reactionKey, emoji)} /> : null}
        {canReact && pickerOpen ? <ReactionPicker mine={mine} onToggle={pick} /> : null}
        {message.failed ? (
          <View ref={setRetryRef} className="mt-1 flex-row items-center gap-1">
            <Pressable onPress={() => onRetry?.(message.id)} disabled={retryDisabled || !onRetry}
              accessibilityRole="button" accessibilityLabel="Resend failed message"
              accessibilityState={{ disabled: retryDisabled || !onRetry }}
              className="min-h-11 flex-row items-center gap-1.5 rounded-lg px-2 py-2 active:bg-raised">
              <RotateCcw size={12} color="#ff5667" />
              <Text className="text-[12px] text-danger">Resend</Text>
            </Pressable>
            <Pressable onPress={() => onDelete?.(message.id)} disabled={!onDelete}
              accessibilityRole="button" accessibilityLabel="Delete failed message"
              accessibilityState={{ disabled: !onDelete }}
              className="min-h-11 justify-center rounded-lg px-2 py-2 active:bg-raised">
              <Text className="text-[12px] text-ink-secondary">Delete</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ReactionPills({ testID, pills, onToggle }: {
  testID: string; pills: ReactionPill[]; onToggle: (emoji: string) => void;
}) {
  return <View testID={testID} className="mt-1 flex-row flex-wrap gap-1">
    {pills.map((pill) => <Pressable key={pill.emoji} onPress={() => onToggle(pill.emoji)} hitSlop={4}
      accessibilityRole="button" accessibilityState={{ selected: pill.mine }}
      accessibilityLabel={`${pill.emoji} ${pill.count}${pill.mine ? ", including yours" : ""}`}
      className={cn("flex-row items-center gap-1 rounded-full border px-2 py-0.5",
        pill.mine ? "border-accent-border bg-raised" : "border-hairline bg-raised active:bg-raised-hover")}>
      <Text className="text-[13px] leading-4">{pill.emoji}</Text>
      <Text className={cn("text-[12px]", pill.mine ? "text-ink" : "text-ink-secondary")}>{pill.count}</Text>
    </Pressable>)}
  </View>;
}

function ReactionPicker({ mine, onToggle }: { mine?: string; onToggle: (emoji: string) => void }) {
  const [more, setMore] = useState(false);
  return (
    <View className="mt-1.5 max-w-full flex-row flex-wrap items-center gap-0.5 rounded-xl border border-hairline bg-panel p-1">
      {QUICK_REACTIONS.map((emoji) => <ReactionKey key={emoji} emoji={emoji} active={mine === emoji} onPress={() => onToggle(emoji)} />)}
      <Pressable onPress={() => setMore((open) => !open)} accessibilityRole="button"
        accessibilityLabel={more ? "Hide more emoji" : "More emoji"} accessibilityState={{ expanded: more }}
        className="h-8 items-center justify-center rounded-lg px-2 active:bg-raised">
        <Text className="text-[12px] text-ink-secondary">{more ? "Less" : "More"}</Text>
      </Pressable>
      {more ? <View className="w-full flex-row flex-wrap gap-0.5 border-t border-hairline pt-1">
        {MORE_REACTIONS.map((emoji) => <ReactionKey key={emoji} emoji={emoji} active={mine === emoji} onPress={() => onToggle(emoji)} />)}
      </View> : null}
    </View>
  );
}

function ReactionKey({ emoji, active, onPress }: { emoji: string; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`React with ${emoji}`}
    accessibilityState={{ selected: active }} hitSlop={2}
    className={cn("h-8 w-8 items-center justify-center rounded-lg", active ? "bg-raised-hover" : "active:bg-raised")}>
    <Text className="text-[17px] leading-6">{emoji}</Text>
  </Pressable>;
}
