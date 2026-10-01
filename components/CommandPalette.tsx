import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Search } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useStore } from "@/lib/store";
import { filterAgentsBySpace } from "@/lib/agents";
import { commandEntries, rankCommandEntries, type CommandEntry } from "@/lib/command-palette";
import { cn } from "@/lib/cn";

const ICON = "#8a8a8a";

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { agents, messagesByAgent, settings, selectAgent, signOut } = useStore();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const activeRef = useRef<View | null>(null);
  const confirmingRef = useRef(false);
  confirmingRef.current = confirming;
  const entries = useMemo(() => rankCommandEntries(
    commandEntries(filterAgentsBySpace(agents, settings.spaceId), messagesByAgent), query),
    [agents, messagesByAgent, settings.spaceId, query]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  const activate = useCallback((entry: CommandEntry) => {
    if (entry.action.type === "select-agent") { selectAgent(entry.action.agentId); onClose(); }
    else if (entry.action.type === "open") { onClose(); router.push(entry.action.path); }
    else setConfirming(true);
  }, [onClose, router, selectAgent]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (confirmingRef.current) setConfirming(false); else onClose();
        return;
      }
      if (confirmingRef.current) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const last = entriesRef.current.length - 1;
        setActiveIndex((index) => event.key === "ArrowDown" ? Math.min(last, index + 1) : Math.max(0, index - 1));
      } else if (event.key === "Enter") {
        const entry = entriesRef.current[activeIndexRef.current];
        if (entry) { event.preventDefault(); activate(entry); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, activate]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    (activeRef.current as unknown as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, entries]);

  const confirmSignOut = () => {
    setConfirming(false);
    onClose();
    void signOut().catch(() => undefined);
  };

  return (
    <View className="absolute inset-0 items-center px-4" style={{ paddingTop: 96 }}>
      <Pressable className="absolute inset-0 bg-black/40" onPress={onClose} accessible={false} focusable={false} />
      <View className="w-full max-w-lg overflow-hidden rounded-2xl border border-hairline bg-panel" accessibilityViewIsModal>
        <View className="flex-row items-center gap-2 border-b border-hairline px-4">
          <Search size={16} color={ICON} />
          <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor={ICON}
            accessibilityLabel="Search commands" autoCorrect={false} autoCapitalize="none"
            className="min-w-0 flex-1 py-3 text-[16px] text-ink outline-none" />
        </View>
        <ScrollView className="max-h-80" keyboardShouldPersistTaps="handled">
          {entries.length === 0 ? <Text className="px-4 py-6 text-[14px] text-ink-secondary">No matches</Text> : null}
          {entries.map((entry, index) => {
            const header = entry.group !== entries[index - 1]?.group;
            const active = index === activeIndex;
            return <View key={entry.id}>
              {header ? <Text className="px-4 pb-1 pt-3 text-[13px] text-ink-secondary">{entry.group}</Text> : null}
              <Pressable ref={active ? activeRef : undefined} onPress={() => activate(entry)}
                {...(Platform.OS === "web" ? { onMouseEnter: () => setActiveIndex(index) } : {})}
                accessibilityRole="button" accessibilityLabel={entry.detail ? `${entry.label}, ${entry.detail}` : entry.label}
                className={cn("mx-2 flex-row items-center gap-3 rounded-xl px-3 py-2", active ? "bg-raised" : "active:bg-raised/40")}>
                <Text className="min-w-0 flex-1 text-[15px] text-ink" numberOfLines={1}>{entry.label}</Text>
                {entry.detail ? <Text className="shrink-0 text-[13px] text-ink-secondary" numberOfLines={1}>{entry.detail}</Text> : null}
              </Pressable>
            </View>;
          })}
        </ScrollView>
      </View>

      <Modal visible={confirming} transparent animationType="fade" onRequestClose={() => setConfirming(false)} statusBarTranslucent>
        <View className="flex-1 items-center justify-center bg-black/60 px-6" accessibilityViewIsModal>
          <Pressable className="absolute inset-0" onPress={() => setConfirming(false)} accessible={false} focusable={false} />
          <View className="w-full max-w-sm rounded-3xl bg-panel p-5">
            <Text className="text-[17px] font-medium text-ink">Sign out?</Text>
            <Text className="mt-1 text-[14px] leading-5 text-ink-secondary">You'll need to sign in again.</Text>
            <View className="mt-5 flex-row items-center justify-end gap-1">
              <Pressable onPress={() => setConfirming(false)} accessibilityRole="button" accessibilityLabel="Cancel sign out"
                className="min-h-11 items-center justify-center rounded-full px-4 active:bg-raised/40">
                <Text className="text-[15px] text-ink-secondary">Cancel</Text>
              </Pressable>
              <Pressable onPress={confirmSignOut} accessibilityRole="button" accessibilityLabel="Confirm sign out"
                className="min-h-11 items-center justify-center rounded-full px-4 active:bg-raised/40">
                <Text className="text-[15px] font-semibold text-danger">Sign out</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
