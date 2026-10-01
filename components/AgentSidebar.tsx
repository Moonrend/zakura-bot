import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Circle, Copy, EyeOff, FolderInput, FolderPlus, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlobAvatar } from "./BlobAvatar";
import { formatTime, useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { useFocusOnRemoval } from "@/lib/use-focus-on-removal";
import { botGroupKey, groupedAgents } from "@/lib/groups";
import { filterAgentsBySpace } from "@/lib/agents";
import { avatarFields } from "@/lib/avatar";
import type { Agent } from "@/lib/types";

const STATUS_DOT = { idle: "bg-success", busy: "bg-warning", offline: "" };
const STATUS_LABEL = { idle: "Available", busy: "Working", offline: "Offline" };
// Screen readers still hear channel state; sighted users get the per-bot dots
// and the recovery banner instead of a status subtitle.
const SR_ONLY = { position: "absolute" as const, width: 1, height: 1, overflow: "hidden" as const, opacity: 0 };
const ICON = "#d4d4d4";
const ROSTER_TIMEOUT_MS = 10_000;

export function AgentSidebar({ query, setQuery, unreadOnly, setUnreadOnly }: {
  query: string;
  setQuery: (query: string) => void;
  unreadOnly: boolean;
  setUnreadOnly: (unreadOnly: boolean) => void;
}) {
  const { agents, selectedId, selectAgent, messagesByAgent, draftsByAgent, typing, connection, transportLabel, setSidebarOpen, groups,
    profiles, settings, updateGroups, hiddenBots, setAgentHidden, setAgentUnread, canManage, updateAgent, deleteAgent, duplicateAgent } = useStore();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 768;
  const pinSearch = height >= 400;
  const searchRef = useRef<TextInput>(null);
  const listRef = useRef<ScrollView>(null);
  const [searchHeight, setSearchHeight] = useState(0);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ agentId: string; x: number; y: number } | null>(null);
  const [menuMove, setMenuMove] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const unreadFilterRef = useRef<View>(null);
  const spaceAgents = useMemo(() => filterAgentsBySpace(agents, settings.spaceId), [agents, settings.spaceId]);
  const boundAgents = useMemo(() => spaceAgents.filter((agent) => !hiddenBots.includes(agent.id)), [spaceAgents, hiddenBots]);
  const hiddenAgents = useMemo(() => hiddenBots
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is Agent => !!agent), [agents, hiddenBots]);
  const allHidden = spaceAgents.length > 0 && boundAgents.length === 0;
  const duplicating = !!duplicatingId || !!duplicate;
  const unreadCount = boundAgents.filter((agent) => agent.unread).length;
  const visible = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    return boundAgents.filter((agent) => (!unreadOnly || agent.unread) && (!value ||
      [agent.name, agent.title, agent.preview, draftsByAgent[agent.id]].some((text) => text?.toLocaleLowerCase().includes(value))));
  }, [boundAgents, draftsByAgent, query, unreadOnly]);
  const menuAgent = menu ? agents.find((agent) => agent.id === menu.agentId) : undefined;
  const showHeaders = groups.sections.length > 0 || groups.pinned.length > 0;
  const openMenu = useCallback((agentId: string, x: number, y: number) => {
    setMenuMove(false);
    setMenu({ agentId, x, y });
  }, []);
  const closeMenu = useCallback(() => { setMenu(null); setMenuMove(false); }, []);
  const commitRename = useCallback((agent: Agent) => {
    const next = renameDraft.trim();
    setRenamingId(null);
    if (!next || next === agent.name.trim()) return;
    void updateAgent(agent.id, { name: next }).catch(() => undefined);
  }, [renameDraft, updateAgent]);
  const removeAgent = useCallback(async (agentId: string) => {
    if (deleting) return;
    setDeleting(true); setDeleteError(null);
    try { await deleteAgent(agentId); setConfirmDelete(null); }
    catch (cause) { setDeleteError(cause instanceof Error ? cause.message : "Could not delete this agent."); }
    finally { setDeleting(false); }
  }, [deleteAgent, deleting]);
  const duplicateAgentById = useCallback(async (agentId: string) => {
    closeMenu();
    setDuplicateError(null); setDuplicateNotice(null); setDuplicatingId(agentId);
    try { setDuplicate(await duplicateAgent(agentId)); }
    catch (cause) { setDuplicateError(cause instanceof Error ? cause.message : "Could not duplicate this agent."); }
    finally { setDuplicatingId(null); }
  }, [closeMenu, duplicateAgent]);
  // The roster frame is the source of truth: select the copy only once it is listed.
  useEffect(() => {
    if (!duplicate || !agents.some((agent) => agent.id === duplicate.id)) return;
    selectAgent(duplicate.id);
    setDuplicate(null);
  }, [agents, duplicate, selectAgent]);
  useEffect(() => {
    if (!duplicate) return;
    const timer = setTimeout(() => {
      setDuplicateNotice("The duplicate hasn't shown up yet. It will appear once the list syncs.");
      setDuplicate(null);
    }, ROSTER_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [duplicate]);
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
  const menuWidth = 232;
  const menuLeft = menu ? Math.max(8, Math.min(menu.x, width - menuWidth - 8)) : 0;
  const menuTop = menu ? Math.max(8, Math.min(menu.y, height - 288)) : 0;
  const pinnedKey = menuAgent ? botGroupKey(menuAgent) : "";
  const isPinned = !!menuAgent && groups.pinned.includes(pinnedKey);
  const sectionId = menuAgent ? groups.assignments[pinnedKey] : undefined;

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
                accessibilityLabel={onlyUnread ? `Unread conversations, ${unreadCount}` : `All conversations, ${boundAgents.length}`}
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
              {!query.trim() && allHidden ? <EyeOff size={24} color="#b8b8b8" />
                : unreadOnly && !query ? <CheckCheck size={24} color="#b8b8b8" /> : <Search size={24} color="#b8b8b8" />}
              <Text className="mt-3 w-full text-center text-[14px] font-semibold text-ink" numberOfLines={2}>
                {query.trim() ? `No matches for “${query.trim()}”` : allHidden ? "You've hidden all your bots."
                  : agents.length === 0 ? "No agents connected" : "All caught up"}
              </Text>
              {!query.trim() && allHidden ? <Pressable accessibilityRole="button" accessibilityLabel="Show hidden bots"
                onPress={() => setHiddenOpen(true)} className="mt-3 min-h-11 justify-center rounded-full bg-raised px-5 active:bg-raised-hover">
                <Text className="text-[14px] font-medium text-ink">Show hidden bots</Text>
              </Pressable> : null}
            </View>
          ) : null}
          {groupedAgents(visible, groups).map((section) => <View key={section.id} testID={`sidebar-group-${section.id}`}>
          {showHeaders ? <Pressable onPress={() => setCollapsed((state) => ({ ...state, [section.id]: !state[section.id] }))}
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
                {...(Platform.OS === "web"
                  ? { onContextMenu: (event: MouseEvent) => { event.preventDefault(); openMenu(agent.id, event.clientX, event.clientY); } }
                  : { onLongPress: (event: { nativeEvent: { pageX: number; pageY: number } }) => openMenu(agent.id, event.nativeEvent.pageX, event.nativeEvent.pageY) })}
                accessibilityRole="button"
                {...(Platform.OS === "web" ? { "aria-pressed": selected } : { accessibilityState: { selected } })}
                accessibilityLabel={`${agent.name}${agent.unread ? ", unread" : ""}. ${STATUS_LABEL[status]}. ${subtitle}`}
                className={cn("mb-0.5 flex-row items-center gap-3.5 rounded-2xl px-3 py-3", selected && !compact ? "bg-panel" : "active:bg-panel")}>
                <View>
                  <BlobAvatar name={agent.name} size={48} {...avatarFields(agent)} />
                  {status !== "offline" ? <View className={cn("absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-app", STATUS_DOT[status])} /> : null}
                </View>
                <View className="min-w-0 flex-1">
                  <View className="flex-row items-baseline justify-between gap-2">
                    {renamingId === agent.id ? <TextInput value={renameDraft} onChangeText={setRenameDraft} autoFocus maxLength={120}
                      accessibilityLabel="Rename agent" returnKeyType="done"
                      onSubmitEditing={() => commitRename(agent)} onBlur={() => commitRename(agent)}
                      onKeyPress={(event) => { if (event.nativeEvent.key === "Escape") { setRenamingId(null); setRenameDraft(agent.name); } }}
                      className={cn("min-w-0 flex-1 py-0 text-[16px] text-ink", agent.unread ? "font-bold" : "font-medium")} />
                    : <AgentNameText name={agent.name} bold={agent.unread} canRename={canManage}
                      onRename={() => { setRenameDraft(agent.name); setRenamingId(agent.id); }} />}
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
      {duplicateError || duplicating || duplicateNotice || hiddenBots.length > 0 ? <View className="px-4" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
        {duplicateError ? <Text accessibilityRole="alert" className="pb-1 text-[13px] leading-5 text-danger">{duplicateError}</Text>
          : duplicating ? <View className="flex-row items-center gap-2 pb-1" accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color="#b3b3b3" />
            <Text className="min-w-0 flex-1 text-[13px] leading-5 text-ink-secondary">Duplicating…</Text>
          </View>
          : duplicateNotice ? <View className="flex-row items-center gap-2 pb-1">
            <Text accessibilityLiveRegion="polite" className="min-w-0 flex-1 text-[13px] leading-5 text-ink-secondary" numberOfLines={2}>{duplicateNotice}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Dismiss duplicate notice" onPress={() => setDuplicateNotice(null)}
              className="h-9 w-9 items-center justify-center rounded-full active:bg-raised/40">
              <X size={15} color="#8a8a8a" />
            </Pressable>
          </View> : null}
        {hiddenBots.length > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={`Hidden bots, ${hiddenBots.length}`}
          onPress={() => setHiddenOpen(true)} className="min-h-11 flex-row items-center gap-2 rounded-xl px-1 active:bg-raised/40">
          <EyeOff size={16} color="#8a8a8a" />
          <Text className="text-[13px] text-ink-secondary">Hidden bots ({hiddenBots.length})</Text>
        </Pressable> : null}
      </View> : null}
      {menu && menuAgent ? <>
        <Pressable className="absolute inset-0" onPress={closeMenu} accessible={false} focusable={false} />
        <View accessibilityViewIsModal className="absolute overflow-hidden rounded-2xl border border-hairline bg-panel"
          style={{ left: menuLeft, top: menuTop, width: menuWidth }}>
          {menuMove ? <>
            <MenuRow icon={ChevronLeft} label="Back" onPress={() => setMenuMove(false)} />
            <MenuRow label="Ungrouped" selected={!sectionId} onPress={() => {
              void updateGroups({ type: "assign", botKey: pinnedKey, sectionId: null }).catch(() => undefined);
              closeMenu();
            }} />
            {groups.sections.map((section) => <MenuRow key={section.id} label={section.name} selected={sectionId === section.id}
              onPress={() => {
                void updateGroups({ type: "assign", botKey: pinnedKey, sectionId: section.id }).catch(() => undefined);
                closeMenu();
              }} />)}
          </> : <>
            <MenuRow icon={Pencil} label="Edit profile" onPress={() => {
              const agentId = menuAgent.id;
              closeMenu();
              setSidebarOpen(false);
              router.push(`/agent-info?agentId=${encodeURIComponent(agentId)}`);
            }} />
            {canManage ? <MenuRow icon={Copy} label="Duplicate" onPress={() => { void duplicateAgentById(menuAgent.id); }} /> : null}
            <MenuRow icon={FolderInput} label="Move to section" onPress={() => setMenuMove(true)} />
            <MenuRow icon={isPinned ? PinOff : Pin} label={isPinned ? "Unpin" : "Pin"} onPress={() => {
              void updateGroups(isPinned ? { type: "unpin", botKey: pinnedKey } : { type: "pin", botKey: pinnedKey }).catch(() => undefined);
              closeMenu();
            }} />
            <MenuRow icon={menuAgent.unread ? CheckCheck : Circle} label={menuAgent.unread ? "Mark as read" : "Mark as unread"} onPress={() => {
              setAgentUnread(menuAgent.id, !menuAgent.unread);
              closeMenu();
            }} />
            <MenuRow icon={EyeOff} label="Hide" onPress={() => {
              void setAgentHidden(menuAgent.id, true).catch(() => undefined);
              closeMenu();
            }} />
            {canManage ? <MenuRow icon={Trash2} label="Delete" danger onPress={() => {
              const agentId = menuAgent.id;
              closeMenu();
              setDeleteError(null);
              setConfirmDelete(agentId);
            }} /> : null}
          </>}
        </View>
      </> : null}
      <Modal transparent visible={!!confirmDelete} animationType="fade" onRequestClose={() => setConfirmDelete(null)} statusBarTranslucent>
        <View className="flex-1 items-center justify-center bg-black/60 px-6">
          <View className="w-full max-w-sm overflow-hidden rounded-3xl bg-panel">
            <Text accessibilityRole="header" className="px-5 pt-5 text-[17px] text-ink">Delete this agent?</Text>
            <Text className="px-5 pb-5 pt-1 text-[14px] leading-5 text-ink-secondary">This can't be undone.</Text>
            {deleteError ? <Text accessibilityRole="alert" className="px-5 pb-3 text-[13px] text-danger">{deleteError}</Text> : null}
            <View className="flex-row border-t border-hairline">
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel delete" disabled={deleting}
                onPress={() => setConfirmDelete(null)} className="min-h-12 flex-1 items-center justify-center active:bg-raised/40">
                <Text className="text-[15px] text-ink-secondary">Cancel</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Confirm delete agent" disabled={deleting}
                onPress={() => { if (confirmDelete) void removeAgent(confirmDelete); }} className="min-h-12 flex-1 items-center justify-center border-l border-hairline active:bg-raised/40">
                {deleting ? <ActivityIndicator size="small" color="#ff5667" /> : <Text className="text-[15px] text-danger">Delete</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal transparent visible={hiddenOpen} animationType="fade" onRequestClose={() => setHiddenOpen(false)} statusBarTranslucent>
        <View className="flex-1 items-center justify-center bg-black/60 px-6">
          <View className="w-full max-w-sm overflow-hidden rounded-3xl bg-panel">
            <View className="flex-row items-center justify-between px-5 pt-5">
              <Text accessibilityRole="header" className="text-[17px] text-ink">Hidden bots</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close hidden bots" onPress={() => setHiddenOpen(false)}
                className="h-9 w-9 items-center justify-center rounded-full active:bg-raised/40">
                <X size={18} color={ICON} />
              </Pressable>
            </View>
            {hiddenAgents.length === 0 ? <Text className="px-5 pb-5 pt-2 text-[14px] leading-5 text-ink-secondary">No hidden bots.</Text>
              : <ScrollView className="max-h-80" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
                {hiddenAgents.map((agent, index) => <View key={agent.id}
                  className={cn("flex-row items-center", index > 0 && "border-t border-hairline")}>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Open ${agent.name} and unhide`}
                    onPress={() => { void setAgentHidden(agent.id, false).catch(() => undefined); selectAgent(agent.id); setHiddenOpen(false); }}
                    className="min-w-0 flex-1 flex-row items-center gap-3 py-2.5 pl-5 pr-2 active:bg-raised/40">
                    <BlobAvatar name={agent.name} size={36} {...avatarFields(agent)} />
                    <Text className="min-w-0 flex-1 text-[15px] text-ink" numberOfLines={1}>{agent.name}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel={`Unhide ${agent.name}`}
                    onPress={() => { void setAgentHidden(agent.id, false).catch(() => undefined); }}
                    className="min-h-11 justify-center px-5 active:bg-raised/40">
                    <Text className="text-[15px] text-accent">Unhide</Text>
                  </Pressable>
                </View>)}
              </ScrollView>}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MenuRow({ label, icon: Icon, selected, danger, onPress }: {
  label: string;
  icon?: typeof Pencil;
  selected?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    className="min-h-11 flex-row items-center gap-3 px-3 active:bg-raised/40">
    {Icon ? <Icon size={17} color={danger ? "#ff5667" : "#8a8a8a"} /> : <View className="w-[17px]" />}
    <Text className={cn("min-w-0 flex-1 text-[15px]", danger ? "text-danger" : "text-ink")} numberOfLines={1}>{label}</Text>
    {selected ? <Check size={16} color="#8a8a8a" /> : null}
  </Pressable>;
}

function AgentNameText({ name, bold, canRename, onRename }: { name: string; bold: boolean; canRename: boolean; onRename: () => void }) {
  const onRenameRef = useRef(onRename);
  onRenameRef.current = onRename;
  const remove = useRef<(() => void) | null>(null);
  const attach = useCallback((node: Text | null) => {
    remove.current?.(); remove.current = null;
    if (Platform.OS !== "web" || !node || !canRename) return;
    const element = node as unknown as HTMLElement;
    const listener = (event: Event) => { event.preventDefault(); onRenameRef.current(); };
    element.addEventListener("dblclick", listener);
    remove.current = () => element.removeEventListener("dblclick", listener);
  }, [canRename]);
  return <Text ref={attach} className={cn("min-w-0 flex-1 text-[16px] text-ink", bold ? "font-bold" : "font-medium")} numberOfLines={1}>{name}</Text>;
}

function AgentRow({ onFocusLost, ...props }: ComponentProps<typeof Pressable> & { onFocusLost: () => void }) {
  const ref = useFocusOnRemoval(onFocusLost);
  return <Pressable {...props} ref={ref} />;
}
