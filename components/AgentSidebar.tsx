import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Plus, Search, Settings, X, FolderPlus } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlobAvatar } from "./BlobAvatar";
import { Field } from "@/components/ui/Field";
import { formatSidebarDate, useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { useFocusOnRemoval } from "@/lib/use-focus-on-removal";
import { groupedAgents } from "@/lib/groups";

const STATUS_LABEL = { idle: "Available", busy: "Working", offline: "Offline" };

export function AgentSidebar({ query, setQuery, unreadOnly, setUnreadOnly }: {
  query: string;
  setQuery: (query: string) => void;
  unreadOnly: boolean;
  setUnreadOnly: (unreadOnly: boolean) => void;
}) {
  const { agents, selectedId, selectAgent, messagesByAgent, draftsByAgent, typing, connection, setSidebarOpen, groups } = useStore();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 768;
  const pinSearch = height >= 400;
  const searchRef = useRef<TextInput>(null);
  const listRef = useRef<ScrollView>(null);
  const [searchHeight, setSearchHeight] = useState(0);
  const unreadFilterRef = useRef<View>(null);
  const unreadCount = agents.filter((agent) => agent.unread).length;
  const visible = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    return agents.filter((agent) => (!unreadOnly || agent.unread) && (!value ||
      [agent.name, agent.title, agent.preview, draftsByAgent[agent.id]].some((text) => text?.toLocaleLowerCase().includes(value))));
  }, [agents, draftsByAgent, query, unreadOnly]);
  const focusList = useCallback(() => {
    if (Platform.OS === "web") {
      const list = listRef.current?.getScrollableNode() as HTMLElement | null | undefined;
      list?.focus({ preventScroll: true });
    }
  }, []);

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
    <View className="h-full w-full border-r border-hairline bg-panel" style={{ paddingTop: Math.max(insets.top, 8) }}
      role={Platform.OS === "web" ? "navigation" : undefined} accessibilityLabel="Agent conversations">
      <View className="flex-row items-center justify-end px-2">
        <Pressable onPress={() => { setSidebarOpen(false); router.push("/bots"); }} className="h-11 w-11 items-center justify-center rounded-xl active:bg-raised"
          accessibilityRole="button" accessibilityLabel="Manage bots">
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
        {/* Use visible window dimensions: a height media query still sees the
            taller layout viewport while a mobile keyboard covers the page. */}
        <View className={cn("sidebar-search bg-panel px-3 pb-1", pinSearch && "sidebar-search-pinned")}
          onLayout={(event) => setSearchHeight(event.nativeEvent.layout.height)}>
          <Field ref={searchRef} value={query} onChangeText={setQuery} placeholder="Search"
            accessibilityLabel="Search agents" autoCorrect={false} autoCapitalize="none" returnKeyType="search"
            icon={<Search size={16} color="#b8b8b8" />}
            trailing={query ? (
              <Pressable onPress={() => { setQuery(""); searchRef.current?.focus(); }} className="h-11 w-11 items-center justify-center"
                accessibilityRole="button" accessibilityLabel="Clear search">
                <X size={16} color="#b8b8b8" />
              </Pressable>
            ) : undefined} />
          <View className="flex-row">
            {[false, true].map((onlyUnread) => (
              <Pressable key={String(onlyUnread)} ref={onlyUnread ? unreadFilterRef : undefined}
                onPress={() => setUnreadOnly(onlyUnread)} accessibilityRole="button"
                accessibilityLabel={onlyUnread ? `Unread conversations, ${unreadCount}` : `All conversations, ${agents.length}`}
                {...(Platform.OS === "web" ? { "aria-pressed": unreadOnly === onlyUnread } : { accessibilityState: { selected: unreadOnly === onlyUnread } })}
                className="min-h-11 flex-1 items-center justify-center">
                <Text className={cn("text-[12px]", unreadOnly === onlyUnread ? "text-ink" : "text-ink-secondary")}>
                  {onlyUnread ? "Unread" : "All"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View className="px-2">
          {visible.length === 0 ? (
            <Text className="px-3 py-6 text-center text-[13px] text-ink-secondary" accessibilityLiveRegion="polite">
              {query.trim() ? `No matches for “${query.trim()}”` : agents.length === 0 ? "No agents connected" : "All caught up"}
            </Text>
          ) : null}
          {groupedAgents(visible, groups).map((section) => <View key={section.id} testID={`sidebar-group-${section.id}`}>
          {groups.sections.length > 0 ? <Text className="px-3 pb-1 pt-3 text-[12px] text-ink-secondary">{section.name}</Text> : null}
          {section.agents.map((agent) => {
            const selected = selectedId === agent.id;
            const messages = messagesByAgent[agent.id] ?? [];
            const last = [...messages].reverse().find((message) => message.kind === "text");
            const status = connection !== "connected" ? "offline" : typing[agent.id] ? "busy" : agent.status;
            const draft = draftsByAgent[agent.id]?.trim();
            const subtitle = draft ? `Draft: ${draft}` : status === "busy" ? "Working…" : agent.preview ?? agent.title ?? "";
            return (
              <AgentRow key={agent.id} onFocusLost={focusList} onPress={() => {
                selectAgent(agent.id);
                if (compact) setSidebarOpen(false);
                else if (unreadOnly && Platform.OS === "web") unreadFilterRef.current?.focus();
              }}
                accessibilityRole="button"
                {...(Platform.OS === "web" ? { "aria-pressed": selected } : { accessibilityState: { selected } })}
                accessibilityLabel={`${agent.name}${agent.unread ? ", unread" : ""}. ${STATUS_LABEL[status]}. ${subtitle}`}
                className={cn("mb-0.5 flex-row items-center gap-3 rounded-xl px-3 py-2.5", selected ? "bg-raised" : "active:bg-raised/50")}>
                <BlobAvatar color={agent.color} name={agent.name} size={40} />
                <View className="min-w-0 flex-1">
                  <View className="flex-row items-baseline justify-between gap-2">
                    <Text className={cn("min-w-0 flex-1 text-[15px] text-ink", agent.unread ? "font-semibold" : "font-medium")} numberOfLines={1}>{agent.name}</Text>
                    {last && !agent.unread ? <Text className="text-[11px] text-ink-secondary">{formatSidebarDate(last.createdAt)}</Text> : null}
                  </View>
                  <View className="mt-0.5 flex-row items-center justify-between gap-2">
                    <Text className={cn("min-w-0 flex-1 text-[13px]", draft ? "text-warning" : agent.unread ? "text-ink" : "text-ink-secondary")} numberOfLines={1}>{subtitle}</Text>
                    {agent.unread ? <View className="h-2 w-2 shrink-0 rounded-full bg-accent" /> : null}
                  </View>
                </View>
              </AgentRow>
            );
          })}</View>)}
        </View>
      </ScrollView>
      <View className="px-2" style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
        <Pressable onPress={() => { setSidebarOpen(false); router.push("/groups"); }} accessibilityRole="button" accessibilityLabel="Manage groups"
          className="min-h-11 flex-row items-center gap-3 rounded-xl px-3 active:bg-raised/50"><FolderPlus size={18} color="#b8b8b8" /><Text className="text-[14px] text-ink">Groups</Text></Pressable>
        <Pressable onPress={openSettings} accessibilityRole="button" accessibilityLabel="Open settings"
          className="min-h-11 flex-row items-center gap-3 rounded-xl px-3 active:bg-raised/50">
          <Settings size={18} color="#b8b8b8" />
          <Text className="text-[14px] text-ink">Settings</Text>
        </Pressable>
      </View>
    </View>
  );
}

function AgentRow({ onFocusLost, ...props }: ComponentProps<typeof Pressable> & { onFocusLost: () => void }) {
  const ref = useFocusOnRemoval(onFocusLost);
  return <Pressable {...props} ref={ref} />;
}
