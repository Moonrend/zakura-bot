import { useState } from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
  Platform,
} from "react-native";
import { Plus, SendHorizontal, Square } from "lucide-react-native";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";

export function Composer({ agentName, busy }: { agentName: string; busy: boolean }) {
  const { send, interrupt } = useStore();
  const [text, setText] = useState("");

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setText("");
    await send(trimmed);
  };

  return (
    <View className="px-4 pb-4 pt-2">
      <View className="mx-auto w-full max-w-3xl flex-row items-center gap-2 rounded-full border border-hairline bg-raised/80 px-2 py-2">
        <Pressable
          className="h-8 w-8 items-center justify-center rounded-full"
          accessibilityLabel="Attach (coming soon)"
        >
          <Plus size={20} color="#fcfcfc99" />
        </Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={busy ? `${agentName} is working…` : `Message ${agentName}`}
          placeholderTextColor="#fcfcfc66"
          className="min-h-[36px] flex-1 text-[15px] text-ink"
          style={Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : undefined}
          multiline
          blurOnSubmit={false}
          onSubmitEditing={() => {
            if (Platform.OS !== "web") void submit();
          }}
          onKeyPress={(e) => {
            if (Platform.OS === "web") {
              const ne = e.nativeEvent as { key?: string; shiftKey?: boolean };
              if (ne.key === "Enter" && !ne.shiftKey) {
                e.preventDefault?.();
                void submit();
              }
            }
          }}
        />
        {busy ? (
          <Pressable
            onPress={() => void interrupt()}
            className="h-8 w-8 items-center justify-center rounded-full bg-raised-hover"
            accessibilityLabel="Stop"
          >
            <Square size={14} color="#fcfcfc" fill="#fcfcfc" />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => void submit()}
            disabled={!text.trim()}
            className={cn(
              "h-8 w-8 items-center justify-center rounded-full",
              text.trim() ? "bg-accent" : "bg-raised",
            )}
            accessibilityLabel="Send"
          >
            <SendHorizontal size={16} color="#fcfcfc" />
          </Pressable>
        )}
      </View>
      <Text className="mt-2 text-center text-[11px] text-ink-secondary">
        Mock channel · replies simulate Zakura chat_reply streaming
      </Text>
    </View>
  );
}
