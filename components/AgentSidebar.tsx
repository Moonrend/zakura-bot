import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Plus, Search, Settings, X } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlobAvatar } from "./BlobAvatar";
import { formatTime, useStore } from "@/lib/store";
import { cn } from "@/lib/cn";

const DOT: Record<string, string> = {
  connected: "bg-success",
  connecting: "bg-warning",
  error: "bg-danger",
  disconnected: "bg-ink-secondary",
};

export function AgentSidebar() {
  const {
    agents,
    selectedId,
    selectAgent,
    messagesByAgent,
    connection,
    transportLabel,
    setSidebarOpen,
  } = useStore();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 768;
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.title ?? "").toLowerCase().includes(q) ||
        (a.preview ?? "").toLowerCase().includes(q),
    );
  }, [agents, query]);

  const connectionLabel =
    connection === "connected"
      ? `${transportLabel} channel · connected`
      : connection === "connecting"
        ? "Connecting…"
        : connection === "error"
          ? "Channel error"
          : "Disconnected";

  return (
    <View
      className="h-full w-full border-r border-hairline bg-panel"
      style={{ paddingTop: Math.max(insets.top, 12) }}
    >
      <View className="flex-row items-center justify-between px-4 pb-1">
        <View className="min-w-0 flex-1">
          <Text className="text-[17px] font-semibold text-ink">Zakura Bot</Text>
          <View className="flex-row items-center gap-1.5">
            <View className={cn("h-1.5 w-1.5 rounded-full", DOT[connection] ?? DOT.disconnected)} />
            <Text className="text-[11px] text-ink-secondary" numberOfLines={1}>
              {connectionLabel}
            </Text>
          </View>
        </View>
        <View className="flex-row items-center">
          <Pressable
            className="rounded-md p-1.5 active:bg-raised"
            accessibilityRole="button"
            accessibilityLabel="New agent (coming soon)"
            accessibilityState={{ disabled: true }}
          >
            <Plus size={20} color="#fcfcfc66" />
          </Pressable>
          {compact ? (
            <Pressable
              onPress={() => setSidebarOpen(false)}
              className="rounded-md p-1.5 active:bg-raised"
              accessibilityRole="button"
              accessibilityLabel="Close agent list"
            >
              <X size={20} color="#fcfcfc99" />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View className="px-3 pb-2 pt-2">
        <View className="flex-row items-center gap-2 rounded-lg bg-raised/60 px-3 py-2">
          <Search size={15} color="#fcfcfc99" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search agents"
            placeholderTextColor="#fcfcfc66"
            accessibilityLabel="Search agents"
            className="flex-1 text-[14px] text-ink"
            style={Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : undefined}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} accessibilityRole="button" accessibilityLabel="Clear search">
              <X size={14} color="#fcfcfc99" />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView className="flex-1 px-2" contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
        {visible.length === 0 ? (
          <Text className="px-3 py-6 text-center text-[13px] text-ink-secondary">No agents match “{query}”</Text>
        ) : null}
        {visible.map((bot) => {
          const selected = selectedId === bot.id;
          const msgs = messagesByAgent[bot.id] ?? [];
          const last = msgs[msgs.length - 1];
          const subtitle =
            bot.status === "busy" ? "Working…" : bot.status === "offline" ? "Offline" : bot.preview ?? bot.title ?? "";
          return (
            <Pressable
              key={bot.id}
              onPress={() => {
                selectAgent(bot.id);
                if (compact) setSidebarOpen(false);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${bot.name}${bot.unread ? ", unread" : ""}. ${subtitle}`}
              className={cn(
                "mb-0.5 flex-row items-center gap-3 rounded-xl px-3 py-2.5",
                selected ? "bg-raised" : "active:bg-raised/50",
              )}
            >
              <View>
                <BlobAvatar color={bot.color} name={bot.name} size={44} />
                {bot.status === "busy" ? (
                  <View className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel bg-warning" />
                ) : bot.status === "offline" ? (
                  <View className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel bg-ink-secondary" />
                ) : null}
              </View>
              <View className="min-w-0 flex-1">
                <View className="flex-row items-baseline justify-between gap-2">
                  <Text
                    className={cn("flex-1 text-[15px] text-ink", bot.unread ? "font-bold" : "font-semibold")}
                    numberOfLines={1}
                  >
                    {bot.name}
                  </Text>
                  {last ? (
                    <Text className="text-[11px] text-ink-secondary">{formatTime(last.createdAt)}</Text>
                  ) : null}
                </View>
                <View className="flex-row items-center justify-between gap-2">
                  <Text
                    className={cn("flex-1 text-[13px]", bot.unread ? "text-ink" : "text-ink-secondary")}
                    numberOfLines={1}
                  >
                    {subtitle}
                  </Text>
                  {bot.unread ? <View className="h-2 w-2 rounded-full bg-accent" /> : null}
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <View className="border-t border-hairline px-3 py-3" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
        <Pressable
          onPress={() => router.push("/settings")}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          className="flex-row items-center gap-3 rounded-xl px-3 py-2 active:bg-raised/50"
        >
          <Settings size={20} color="#fcfcfc99" />
          <Text className="text-[14px] text-ink">Settings</Text>
        </Pressable>
      </View>
    </View>
  );
}
