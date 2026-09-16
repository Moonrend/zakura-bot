import { useRef, useState } from "react";
import { Pressable, Text, TextInput, View, Platform } from "react-native";
import { ArrowUp, Plus, Square } from "lucide-react-native";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";

const MAX_LEN = 4000;

export function Composer({
  agentName,
  busy,
  bottomInset = 0,
}: {
  agentName: string;
  busy: boolean;
  bottomInset?: number;
}) {
  const { send, interrupt, connection, transportLabel } = useStore();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const offline = connection !== "connected";
  const canSend = text.trim().length > 0 && !busy && !offline;

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy || offline) return;
    setText("");
    const ok = await send(trimmed);
    if (!ok) setText(trimmed); // keep the draft when the channel rejected it
    inputRef.current?.focus();
  };

  const hint = offline
    ? "Channel offline · reconnect to send"
    : busy
      ? "Press Stop to interrupt the current reply"
      : `${transportLabel} channel · Enter to send, Shift+Enter for newline`;

  return (
    <View className="px-4 pt-2" style={{ paddingBottom: Math.max(bottomInset, 12) }}>
      <View
        className={cn(
          "mx-auto w-full max-w-3xl flex-row items-end gap-2 rounded-[26px] border bg-raised/80 px-2 py-2",
          focused ? "border-accent-border/60" : "border-hairline",
          offline && "opacity-70",
        )}
      >
        <Pressable
          className="h-9 w-9 items-center justify-center rounded-full active:bg-raised-hover"
          accessibilityRole="button"
          accessibilityLabel="Attach (coming soon)"
          accessibilityState={{ disabled: true }}
        >
          <Plus size={20} color="#fcfcfc66" />
        </Pressable>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={(t) => setText(t.slice(0, MAX_LEN))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          editable={!offline}
          placeholder={busy ? `${agentName} is working…` : `Message ${agentName}`}
          placeholderTextColor="#fcfcfc66"
          accessibilityLabel={`Message ${agentName}`}
          className="max-h-[160px] min-h-[36px] flex-1 py-2 text-[15px] leading-5 text-ink"
          style={Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : undefined}
          multiline
          submitBehavior="newline"
          onKeyPress={(e) => {
            if (Platform.OS !== "web") return;
            const ne = e.nativeEvent as { key?: string; shiftKey?: boolean };
            if (ne.key === "Enter" && !ne.shiftKey) {
              e.preventDefault?.();
              void submit();
            }
          }}
        />
        {busy ? (
          <Pressable
            onPress={() => void interrupt()}
            className="h-9 w-9 items-center justify-center rounded-full bg-ink active:opacity-80"
            accessibilityRole="button"
            accessibilityLabel="Stop generating"
          >
            <Square size={13} color="#070707" fill="#070707" />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => void submit()}
            disabled={!canSend}
            className={cn(
              "h-9 w-9 items-center justify-center rounded-full",
              canSend ? "bg-accent active:opacity-80" : "bg-raised-hover",
            )}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !canSend }}
          >
            <ArrowUp size={18} color={canSend ? "#fcfcfc" : "#fcfcfc66"} />
          </Pressable>
        )}
      </View>
      <View className="mx-auto mt-1.5 w-full max-w-3xl flex-row items-center justify-between px-2">
        <Text className="text-[11px] text-ink-secondary" numberOfLines={1}>
          {hint}
        </Text>
        {text.length > MAX_LEN * 0.8 ? (
          <Text className="text-[11px] text-ink-secondary">
            {text.length}/{MAX_LEN}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
