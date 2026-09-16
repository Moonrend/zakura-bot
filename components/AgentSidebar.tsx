import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Plus, Search, Settings } from "lucide-react-native";
import { useRouter } from "expo-router";
import { BlobAvatar } from "./BlobAvatar";
import { formatTime, useStore } from "@/lib/store";
import { cn } from "@/lib/cn";

export function AgentSidebar() {
  const { agents, selectedId, selectAgent, messagesByAgent, connection, setSidebarOpen } =
    useStore();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const compact = width < 768;

  return (
    <View className="h-full w-full border-r border-hairline bg-panel md:w-80">
      <View className="flex-row items-center justify-between px-4 pb-1 pt-4">
        <View>
          <Text className="text-[17px] font-semibold text-ink">Zakura Bot</Text>
          <Text className="text-[11px] text-ink-secondary">
            {connection === "connected" ? "Mock channel connected" : connection}
          </Text>
        </View>
        <Pressable className="rounded-md p-1.5" accessibilityLabel="New agent (soon)">
          <Plus size={20} color="#fcfcfc99" />
        </Pressable>
      </View>

      <View className="px-3 pb-3 pt-2">
        <View className="flex-row items-center gap-2 rounded-lg bg-raised/70 px-3 py-2">
          <Search size={16} color="#fcfcfc99" />
          <TextInput
            placeholder="Search"
            placeholderTextColor="#fcfcfc66"
            className="flex-1 text-[14px] text-ink"
            editable={false}
          />
        </View>
      </View>

      <ScrollView className="flex-1 px-2" contentContainerStyle={{ paddingBottom: 12 }}>
        {agents.map((bot) => {
          const selected = selectedId === bot.id;
          const msgs = messagesByAgent[bot.id] ?? [];
          const last = msgs[msgs.length - 1];
          return (
            <Pressable
              key={bot.id}
              onPress={() => {
                selectAgent(bot.id);
                if (compact) setSidebarOpen(false);
              }}
              className={cn(
                "mb-0.5 flex-row items-center gap-3 rounded-xl px-3 py-2.5",
                selected ? "bg-raised" : "active:bg-raised/50",
              )}
            >
              <BlobAvatar color={bot.color} name={bot.name} size={44} />
              <View className="min-w-0 flex-1">
                <View className="flex-row items-baseline justify-between gap-2">
                  <Text className="flex-1 text-[15px] font-semibold text-ink" numberOfLines={1}>
                    {bot.name}
                  </Text>
                  {last ? (
                    <Text className="text-[11px] text-ink-secondary">
                      {formatTime(last.createdAt)}
                    </Text>
                  ) : null}
                </View>
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="flex-1 text-[13px] text-ink-secondary" numberOfLines={1}>
                    {bot.status === "busy" ? "Working…" : bot.preview ?? bot.title ?? ""}
                  </Text>
                  {bot.unread ? (
                    <View className="h-2 w-2 rounded-full bg-accent" />
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <View className="border-t border-hairline px-3 py-3">
        <Pressable
          onPress={() => router.push("/settings")}
          className="flex-row items-center gap-3 rounded-xl px-3 py-2 active:bg-raised/50"
        >
          <Settings size={20} color="#fcfcfc99" />
          <Text className="text-[14px] text-ink">Settings</Text>
        </Pressable>
      </View>
    </View>
  );
}
