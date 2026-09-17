import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Plus, Search, Settings, X, CheckCheck } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlobAvatar } from "./BlobAvatar";
import { formatTime, useStore } from "@/lib/store";
import { cn } from "@/lib/cn";

const CONNECTION_DOT = { connected: "bg-success", connecting: "bg-warning", error: "bg-danger", disconnected: "bg-ink-secondary" };
const STATUS_DOT = { idle: "bg-success", busy: "bg-warning", offline: "bg-ink-secondary" };
const STATUS_LABEL = { idle: "Available", busy: "Working", offline: "Offline" };

export function AgentSidebar() {
  const { agents, selectedId, selectAgent, messagesByAgent, draftsByAgent, typing, connection, transportLabel, setSidebarOpen } = useStore();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 768;
  const pinSearch = height >= 400;
  const [query, setQuery] = useState("");
  const searchRef = useRef<TextInput>(null);
  const listRef = useRef<ScrollView>(null);
  const [searchHeight, setSearchHeight] = useState(0);
  const unreadFilterRef = useRef<View>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const unreadCount = agents.filter((agent) => agent.unread).length;
  const visible = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    return agents.filter((agent) => (!unreadOnly || agent.unread) && (!value ||
      [agent.name, agent.title, agent.preview, draftsByAgent[agent.id]].some((text) => text?.toLocaleLowerCase().includes(value))));
  }, [agents, draftsByAgent, query, unreadOnly]);
  const connectionLabel = connection === "connected" ? `${transportLabel} channel · connected`
    : connection === "connecting" ? "Connecting…" : connection === "error" ? "Channel error" : "Disconnected";

  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const list = listRef.current?.getScrollableNode() as HTMLElement | null | undefined;
    // Browser focus scrolling must leave room for the pinned search controls,
    // including when navigating back up a long roster with Shift+Tab.
    if (list) list.style.scrollPaddingTop = `${pinSearch ? searchHeight : 0}px`;
  }, [pinSearch, searchHeight]);

  const openSettings = () => {
    setSidebarOpen(false);
    router.push("/settings");
  };

  return (
    <View className="h-full w-full border-r border-hairline bg-panel" style={{ paddingTop: Math.max(insets.top, 12) }}
      role={Platform.OS === "web" ? "navigation" : undefined} accessibilityLabel="Agent conversations">
      <View className="flex-row items-center justify-between px-4 pb-2">
        <View className="min-w-0 flex-1">
          <Text className="text-[17px] font-semibold text-ink" accessibilityRole="header">Zakura Bot</Text>
          <View className="mt-1 flex-row items-center gap-1.5">
            <View className={cn("h-1.5 w-1.5 rounded-full", CONNECTION_DOT[connection])} />
            <Text className="text-[11px] text-ink-secondary" numberOfLines={1}>{connectionLabel}</Text>
          </View>
        </View>
        <Pressable disabled className="h-11 w-11 items-center justify-center rounded-xl opacity-40"
          accessibilityRole="button" accessibilityLabel="Adding agents is not available yet" accessibilityState={{ disabled: true }}>
          <Plus size={20} color="#b8b8b8" />
        </Pressable>
        {compact ? (
          <Pressable onPress={() => setSidebarOpen(false)} className="h-11 w-11 items-center justify-center rounded-xl active:bg-raised"
            accessibilityRole="button" accessibilityLabel="Close agent list">
            <X size={20} color="#b8b8b8" />
          </Pressable>
        ) : null}
      </View>

      <ScrollView ref={listRef} className="sidebar-scroll min-h-0 flex-1" contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled"
        accessibilityLabel="Agent list" role={Platform.OS === "web" ? "region" : undefined}
        tabIndex={Platform.OS === "web" ? 0 : undefined}>
        {/* CSS pins search on taller web windows without remounting focused
            inputs when the keyboard or viewport changes the available height. */}
        <View className="sidebar-search bg-panel px-3 pb-2" onLayout={(event) => setSearchHeight(event.nativeEvent.layout.height)}>
          <View className="min-h-11 flex-row items-center gap-2 rounded-xl border border-hairline bg-inset pl-3">
            <Search size={16} color="#b8b8b8" />
            <TextInput ref={searchRef} value={query} onChangeText={setQuery} placeholder="Search agents" placeholderTextColor="#a3a3a3"
              accessibilityLabel="Search agents" className="min-w-0 flex-1 rounded-lg py-3 text-[14px] text-ink"
              autoCorrect={false} autoCapitalize="none" returnKeyType="search" />
            {query ? (
              <Pressable onPress={() => { setQuery(""); searchRef.current?.focus(); }} className="h-11 w-11 items-center justify-center rounded-xl active:bg-raised"
                accessibilityRole="button" accessibilityLabel="Clear search">
                <X size={16} color="#b8b8b8" />
              </Pressable>
            ) : <View className="w-3" />}
          </View>
          <View className="mt-2 flex-row gap-1">
            {[false, true].map((onlyUnread) => (
              <Pressable key={String(onlyUnread)} ref={onlyUnread ? unreadFilterRef : undefined}
                onPress={() => setUnreadOnly(onlyUnread)} accessibilityRole="button"
                accessibilityLabel={onlyUnread ? `Unread conversations, ${unreadCount}` : `All conversations, ${agents.length}`}
                {...(Platform.OS === "web" ? { "aria-pressed": unreadOnly === onlyUnread } : { accessibilityState: { selected: unreadOnly === onlyUnread } })}
                className={cn("min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-xl px-3", unreadOnly === onlyUnread ? "bg-raised" : "active:bg-raised/50")}>
                <Text className={cn("text-[12px] font-semibold", unreadOnly === onlyUnread ? "text-ink" : "text-ink-secondary")}>
                  {onlyUnread ? "Unread" : "All agents"}
                </Text>
                <Text className="text-[11px] text-ink-secondary">{onlyUnread ? unreadCount : agents.length}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View className="px-2">
          {visible.length === 0 ? (
            <View className="items-center px-4 py-8" accessibilityLiveRegion="polite">
              {unreadOnly && !query ? <CheckCheck size={24} color="#b8b8b8" /> : <Search size={24} color="#b8b8b8" />}
              <Text className="mt-3 w-full text-center text-[14px] font-semibold text-ink" numberOfLines={2}>
                {query.trim() ? `No matches for “${query.trim()}”` : agents.length === 0 ? "No agents connected" : "All caught up"}
              </Text>
              <Text className="mt-2 text-center text-[12px] leading-5 text-ink-secondary">
                {query.trim() ? "Try another name or clear your search." : agents.length === 0 ? "Check your channel in Settings." : "New replies will appear here."}
              </Text>
            </View>
          ) : null}
          {visible.map((agent) => {
            const selected = selectedId === agent.id;
            const messages = messagesByAgent[agent.id] ?? [];
            const last = [...messages].reverse().find((message) => message.kind === "text");
            const status = connection !== "connected" ? "offline" : typing[agent.id] ? "busy" : agent.status;
            const draft = draftsByAgent[agent.id]?.trim();
            const subtitle = draft ? `Draft: ${draft}` : status === "busy" ? "Working…" : agent.preview ?? agent.title ?? "No messages yet";
            return (
              <Pressable key={agent.id} onPress={() => {
                selectAgent(agent.id);
                if (compact) setSidebarOpen(false);
                else if (unreadOnly && Platform.OS === "web") unreadFilterRef.current?.focus();
              }}
                accessibilityRole="button"
                {...(Platform.OS === "web" ? { "aria-pressed": selected } : { accessibilityState: { selected } })}
                accessibilityLabel={`${agent.name}${agent.unread ? ", unread" : ""}. ${STATUS_LABEL[status]}. ${subtitle}`}
                className={cn("mb-1 flex-row items-center gap-3 rounded-xl px-3 py-3", selected ? "bg-raised" : "active:bg-raised/50")}>
                <View>
                  <BlobAvatar color={agent.color} name={agent.name} size={44} />
                  <View className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel", STATUS_DOT[status])} />
                </View>
                <View className="min-w-0 flex-1">
                  <View className="flex-row items-baseline justify-between gap-2">
                    <Text className={cn("min-w-0 flex-1 text-[15px] text-ink", agent.unread ? "font-bold" : "font-semibold")} numberOfLines={1}>{agent.name}</Text>
                    {last ? <Text className="text-[11px] text-ink-secondary">{formatTime(last.createdAt)}</Text> : null}
                  </View>
                  <View className="mt-1 flex-row items-center justify-between gap-2">
                    <Text className={cn("min-w-0 flex-1 text-[13px]", draft ? "text-warning" : agent.unread ? "text-ink" : "text-ink-secondary")} numberOfLines={1}>{subtitle}</Text>
                    {agent.unread ? <View className="h-2 w-2 shrink-0 rounded-full bg-accent" /> : null}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <View className="border-t border-hairline px-3 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
        <Pressable onPress={openSettings} accessibilityRole="button" accessibilityLabel="Open settings"
          className="min-h-11 flex-row items-center gap-3 rounded-xl px-3 py-3 active:bg-raised/50">
          <Settings size={20} color="#b8b8b8" />
          <Text className="text-[14px] text-ink">Settings</Text>
        </Pressable>
      </View>
    </View>
  );
}
