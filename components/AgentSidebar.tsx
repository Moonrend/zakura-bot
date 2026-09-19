import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Plus, Search, X, CheckCheck, FolderPlus, ChevronDown, ChevronRight } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlobAvatar } from "./BlobAvatar";
import { formatTime, useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { useFocusOnRemoval } from "@/lib/use-focus-on-removal";
import { groupedAgents } from "@/lib/groups";

const STATUS_DOT = { idle: "bg-success", busy: "bg-warning", offline: "" };
const STATUS_LABEL = { idle: "Available", busy: "Working", offline: "Offline" };
// Screen readers still hear channel state; sighted users get the per-bot dots
// and the recovery banner instead of a status subtitle.
const SR_ONLY = { position: "absolute" as const, width: 1, height: 1, overflow: "hidden" as const, opacity: 0 };
const ICON = "#d4d4d4";

export function AgentSidebar({ query, setQuery, unreadOnly, setUnreadOnly }: {
  query: string;
  setQuery: (query: string) => void;
  unreadOnly: boolean;
  setUnreadOnly: (unreadOnly: boolean) => void;
}) {
  const { agents, selectedId, selectAgent, messagesByAgent, draftsByAgent, typing, connection, transportLabel, setSidebarOpen, groups,
    profiles, settings } = useStore();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 768;
  const pinSearch = height >= 400;
  const searchRef = useRef<TextInput>(null);
  const listRef = useRef<ScrollView>(null);
  const [searchHeight, setSearchHeight] = useState(0);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const unreadFilterRef = useRef<View>(null);
  const unreadCount = agents.filter((agent) => agent.unread).length;
  const visible = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    return agents.filter((agent) => (!unreadOnly || agent.unread) && (!value ||
      [agent.name, agent.title, agent.preview, draftsByAgent[agent.id]].some((text) => text?.toLocaleLowerCase().includes(value))));
  }, [agents, draftsByAgent, query, unreadOnly]);
  const connectionLabel = connection === "connected" ? `${transportLabel} channel · connected`
    : connection === "connecting" ? "Connecting…" : connection === "error" ? "Channel error" : "Disconnected";
  const profileLabel = settings.useMockChannel ? "Demo" : profiles.find((profile) => profile.id === settings.profileId)?.label ?? "Zakura";
  const initials = profileLabel.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join("") || "Z";
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

  const open = (path: "/settings" | "/bots" | "/groups") => {
    setSidebarOpen(false);
    router.push(path);
  };
  const circle = "h-11 w-11 items-center justify-center rounded-full bg-raised active:bg-raised-hover";

  return (
    <View className="h-full w-full bg-app" style={{ paddingTop: Math.max(insets.top, 12) }}
      role={Platform.OS === "web" ? "navigation" : undefined} accessibilityLabel="Agent conversations">
      <View className="flex-row items-center justify-between px-4 pb-3 pt-1">
        <Pressable onPress={() => open("/settings")} className={circle} accessibilityRole="button" accessibilityLabel="Open settings">
          <Text className="text-[15px] font-semibold text-ink-secondary">{initials}</Text>
        </Pressable>
        <Text accessibilityLiveRegion="polite" style={SR_ONLY}>{connectionLabel}</Text>
        <View className="flex-row items-center gap-2">
          <Pressable onPress={() => open("/groups")} className={circle} accessibilityRole="button" accessibilityLabel="Manage groups">
            <FolderPlus size={19} color={ICON} />
          </Pressable>
          <Pressable onPress={() => open("/bots")} className={circle} accessibilityRole="button" accessibilityLabel="Manage bots">
            <Plus size={22} color={ICON} />
          </Pressable>
          {compact ? (
            <Pressable onPress={() => setSidebarOpen(false)} className={circle} accessibilityRole="button" accessibilityLabel="Close agent list">
              <X size={20} color={ICON} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView ref={listRef} className="sidebar-scroll min-h-0 flex-1" contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 12) }} keyboardShouldPersistTaps="handled"
        accessibilityLabel="Agent list" role={Platform.OS === "web" ? "region" : undefined}
        tabIndex={Platform.OS === "web" ? 0 : undefined}>
        {/* Use visible window dimensions: a height media query still sees the
            taller layout viewport while a mobile keyboard covers the page. */}
        <View className={cn("sidebar-search bg-app px-4 pb-1", pinSearch && "sidebar-search-pinned")}
          onLayout={(event) => setSearchHeight(event.nativeEvent.layout.height)}>
          <View className="min-h-11 flex-row items-center gap-2 rounded-full bg-panel pl-4">
            <Search size={16} color="#8a8a8a" />
            <TextInput ref={searchRef} value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor="#8a8a8a"
              accessibilityLabel="Search agents" className="min-w-0 flex-1 py-3 text-[15px] text-ink"
              autoCorrect={false} autoCapitalize="none" returnKeyType="search" />
            {query ? (
              <Pressable onPress={() => { setQuery(""); searchRef.current?.focus(); }} className="h-11 w-11 items-center justify-center rounded-full"
                accessibilityRole="button" accessibilityLabel="Clear search">
                <X size={16} color={ICON} />
              </Pressable>
            ) : <View className="w-4" />}
          </View>
          <View className="flex-row gap-1 pt-1">
            {[false, true].map((onlyUnread) => (
              <Pressable key={String(onlyUnread)} ref={onlyUnread ? unreadFilterRef : undefined}
                onPress={() => setUnreadOnly(onlyUnread)} accessibilityRole="button"
                accessibilityLabel={onlyUnread ? `Unread conversations, ${unreadCount}` : `All conversations, ${agents.length}`}
                {...(Platform.OS === "web" ? { "aria-pressed": unreadOnly === onlyUnread } : { accessibilityState: { selected: unreadOnly === onlyUnread } })}
                className="min-h-11 flex-row items-center gap-1.5 rounded-full px-3">
                <Text className={cn("text-[13px]", unreadOnly === onlyUnread ? "font-semibold text-ink" : "text-ink-secondary")}>
                  {onlyUnread ? "Unread" : "All"}
                </Text>
                {onlyUnread && unreadCount ? <Text className="text-[12px] text-ink-secondary">{unreadCount}</Text> : null}
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
            </View>
          ) : null}
          {groupedAgents(visible, groups).map((section) => <View key={section.id} testID={`sidebar-group-${section.id}`}>
          {groups.sections.length > 0 ? <Pressable onPress={() => setCollapsed((state) => ({ ...state, [section.id]: !state[section.id] }))}
            accessibilityRole="button" accessibilityLabel={`${section.name} group`}
            {...(Platform.OS === "web" ? { "aria-expanded": !collapsed[section.id] } : { accessibilityState: { expanded: !collapsed[section.id] } })}
            className="min-h-11 flex-row items-center gap-1.5 px-3 pb-1 pt-4">
            <Text className="text-[16px] text-ink-secondary" numberOfLines={1}>{section.name}</Text>
            {collapsed[section.id] ? <ChevronRight size={16} color="#8a8a8a" /> : <ChevronDown size={16} color="#8a8a8a" />}
          </Pressable> : null}
          {collapsed[section.id] ? null : section.agents.map((agent) => {
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
                className={cn("mb-0.5 flex-row items-center gap-3.5 rounded-2xl px-3 py-3", selected && !compact ? "bg-panel" : "active:bg-panel")}>
                <View>
                  <BlobAvatar color={agent.color} name={agent.name} size={48} />
                  {status !== "offline" ? <View className={cn("absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-app", STATUS_DOT[status])} /> : null}
                </View>
                <View className="min-w-0 flex-1">
                  <View className="flex-row items-baseline justify-between gap-2">
                    <Text className={cn("min-w-0 flex-1 text-[16px] text-ink", agent.unread ? "font-bold" : "font-medium")} numberOfLines={1}>{agent.name}</Text>
                    {last ? <Text className="text-[12px] text-ink-secondary">{formatTime(last.createdAt)}</Text> : null}
                  </View>
                  {subtitle ? <View className="mt-0.5 flex-row items-center justify-between gap-2">
                    <Text className={cn("min-w-0 flex-1 text-[14px]", draft ? "text-warning" : agent.unread ? "text-ink" : "text-ink-secondary")} numberOfLines={1}>{subtitle}</Text>
                    {agent.unread ? <View className="h-2 w-2 shrink-0 rounded-full bg-accent" /> : null}
                  </View> : null}
                </View>
              </AgentRow>
            );
          })}</View>)}
        </View>
      </ScrollView>
    </View>
  );
}

function AgentRow({ onFocusLost, ...props }: ComponentProps<typeof Pressable> & { onFocusLost: () => void }) {
  const ref = useFocusOnRemoval(onFocusLost);
  return <Pressable {...props} ref={ref} />;
}
