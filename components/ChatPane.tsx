import { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Menu } from "lucide-react-native";
import { BlobAvatar } from "./BlobAvatar";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import { formatTime, useStore } from "@/lib/store";

export function ChatPane() {
  const {
    agents,
    selectedId,
    messagesByAgent,
    typing,
    sidebarOpen,
    setSidebarOpen,
  } = useStore();
  const agent = agents.find((a) => a.id === selectedId) ?? agents[0];
  const messages = messagesByAgent[agent?.id ?? ""] ?? [];
  const busy = !!typing[agent?.id ?? ""] || agent?.status === "busy";
  const scrollRef = useRef<ScrollView>(null);
  const { width } = useWindowDimensions();
  const compact = width < 768;

  useEffect(() => {
    const t = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 50);
    return () => clearTimeout(t);
  }, [messages.length, busy, selectedId]);

  if (!agent) {
    return (
      <View className="flex-1 items-center justify-center bg-app">
        <Text className="text-ink-secondary">No agent selected</Text>
      </View>
    );
  }

  const first = messages[0];

  return (
    <View className="flex-1 bg-app">
      <View className="flex-row items-center justify-between px-4 py-3">
        <View className="flex-row items-center gap-2">
          {compact && !sidebarOpen ? (
            <Pressable
              onPress={() => setSidebarOpen(true)}
              className="mr-1 rounded-md p-1.5"
              accessibilityLabel="Open sidebar"
            >
              <Menu size={20} color="#fcfcfc" />
            </Pressable>
          ) : null}
          <BlobAvatar color={agent.color} name={agent.name} size={28} />
          <Text className="text-[15px] font-semibold text-ink">{agent.name}</Text>
          {busy ? <ActivityIndicator size="small" color="#fcfcfc99" /> : null}
        </View>
        <Text className="text-[12px] text-ink-secondary">{agent.title ?? "Agent"}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 16, maxWidth: 900, width: "100%", alignSelf: "center" }}
      >
        {first ? (
          <Text className="mb-3 py-2 text-center text-[12px] text-ink-secondary">
            Today · {formatTime(first.createdAt)}
          </Text>
        ) : (
          <View className="items-center py-16">
            <BlobAvatar color={agent.color} name={agent.name} size={56} />
            <Text className="mt-4 text-[16px] font-semibold text-ink">{agent.name}</Text>
            <Text className="mt-1 text-[13px] text-ink-secondary">
              Send a message to start the thread
            </Text>
          </View>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {busy ? (
          <View className="mb-2 flex-row items-center gap-2">
            <ActivityIndicator size="small" color="#fcfcfc99" />
            <Text className="text-[13px] text-ink-secondary">{agent.name} is working…</Text>
          </View>
        ) : null}
      </ScrollView>

      <Composer agentName={agent.name} busy={busy} />
    </View>
  );
}
