import { useRef, useState } from "react";
import { Pressable, Text, TextInput, View, Platform } from "react-native";
import { ArrowUp, Plus, Square } from "lucide-react-native";
import { useStore } from "@/lib/store";
import { MAX_MESSAGE_LENGTH } from "@/lib/channel";
import { cn } from "@/lib/cn";

export function Composer({ agentName, busy, agentOffline = false, bottomInset = 0 }: {
  agentName: string;
  busy: boolean;
  agentOffline?: boolean;
  bottomInset?: number;
}) {
  const { selectedId, draftsByAgent, setDraft, clearDraft, send, interrupt, connection } = useStore();
  const text = draftsByAgent[selectedId] ?? "";
  const [focused, setFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [height, setHeight] = useState(44);
  const sending = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const offline = connection !== "connected" || agentOffline;
  const canSend = text.trim().length > 0 && !busy && !offline && !submitting;

  const submit = async () => {
    if (!canSend || sending.current) return;
    const agentId = selectedId;
    const draft = text;
    sending.current = true;
    setSubmitting(true);
    try {
      const ok = await send(draft, agentId);
      if (ok) clearDraft(agentId, draft);
    } finally {
      sending.current = false;
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };

  const hint = offline ? "Offline · your draft stays in this conversation"
    : busy ? "You can draft your next message while the agent replies"
      : Platform.OS === "web" ? "Enter to send · Shift+Enter for a new line" : "Write a message, then tap Send";

  return (
    <View className="px-4 pt-2" style={{ paddingBottom: Math.max(bottomInset, 12) }}>
      <View className={cn(
        "mx-auto w-full max-w-3xl flex-row items-end gap-1 rounded-[26px] border bg-raised/80 p-1.5",
        focused ? "border-accent-border" : "border-hairline",
      )}>
        <Pressable disabled className="h-11 w-11 shrink-0 items-center justify-center rounded-full opacity-40"
          accessibilityRole="button" accessibilityLabel="Attachments are not available yet" accessibilityState={{ disabled: true }}>
          <Plus size={20} color="#b8b8b8" />
        </Pressable>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={(value) => setDraft(selectedId, value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onContentSizeChange={(event) => setHeight(Math.min(160, Math.max(44, event.nativeEvent.contentSize.height)))}
          placeholder={busy ? `Reply to ${agentName}…` : `Message ${agentName}`}
          placeholderTextColor="#a3a3a3"
          accessibilityLabel={`Message ${agentName}`}
          accessibilityHint={offline ? "You can write a draft; sending is unavailable while offline." : hint}
          className="min-w-0 flex-1 rounded-xl px-1 py-3 text-[15px] leading-5 text-ink"
          style={{ height, maxHeight: 160, textAlignVertical: "top" }}
          maxLength={MAX_MESSAGE_LENGTH}
          multiline
          numberOfLines={1}
          submitBehavior="newline"
          onKeyPress={(event) => {
            if (Platform.OS !== "web") return;
            const nativeEvent = event.nativeEvent as { key?: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number };
            // Enter commits a CJK composition before it can submit a message.
            if (nativeEvent.key === "Enter" && !nativeEvent.shiftKey && !nativeEvent.isComposing && nativeEvent.keyCode !== 229) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        {busy ? (
          <Pressable onPress={() => void interrupt()} disabled={connection !== "connected"}
            className="h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink active:opacity-80"
            accessibilityRole="button" accessibilityLabel="Stop generating"
            accessibilityState={{ disabled: connection !== "connected" }}>
            <Square size={14} color="#070707" fill="#070707" />
          </Pressable>
        ) : (
          <Pressable onPress={() => void submit()} disabled={!canSend}
            className={cn("h-11 w-11 shrink-0 items-center justify-center rounded-full", canSend ? "bg-accent active:opacity-80" : "bg-raised-hover")}
            accessibilityRole="button" accessibilityLabel="Send message" accessibilityState={{ disabled: !canSend, busy: submitting }}>
            <ArrowUp size={20} color={canSend ? "#fcfcfc" : "#a3a3a3"} />
          </Pressable>
        )}
      </View>
      <View className="mx-auto mt-2 w-full max-w-3xl flex-row items-start justify-between gap-2 px-2">
        <Text className="min-w-0 flex-1 text-[11px] leading-4 text-ink-secondary">{hint}</Text>
        {text.length > MAX_MESSAGE_LENGTH * 0.8 ? (
          <Text className={cn("shrink-0 text-[11px] leading-4", text.length === MAX_MESSAGE_LENGTH ? "text-warning" : "text-ink-secondary")}
            accessibilityLabel={`${text.length} of ${MAX_MESSAGE_LENGTH} characters`}>
            {text.length}/{MAX_MESSAGE_LENGTH}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
