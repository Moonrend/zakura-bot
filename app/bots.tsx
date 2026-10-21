import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { ChevronRight, Network, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "@/lib/store";
import { BlobAvatar } from "@/components/BlobAvatar";
import { AgentForm } from "@/components/AgentForm";
import { cn } from "@/lib/cn";
import { groupAgentsBySpace } from "@/lib/agents";
import { avatarFields } from "@/lib/avatar";

const CIRCLE = "h-11 w-11 items-center justify-center rounded-full bg-raised active:bg-raised-hover";
const SMALL = "h-9 w-9 items-center justify-center rounded-full active:bg-raised-hover";
const ICON = "#d4d4d4";

export default function BotsScreen() {
  const { agents, selectedId, selectAgent, reconnect,
    canManage, deleteAgent, settings, hiddenBots } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < 768;
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const selected = agents.find((row) => row.id === selectedId);
  const visibleAgents = agents.filter((agent) => !hiddenBots.includes(agent.id));
  useEffect(() => {
    setEditing(false); setConfirmingDelete(false);
  }, [selectedId]);
  function startEdit() {
    if (!selected) return;
    setError(null); setNotice(null); setEditing(true);
  }
  function startCreate() {
    setError(null); setNotice(null);
    if (compact) { router.push("/bots/new"); return; }
    setCreating(true);
  }
  async function removeAgent() {
    if (!selected) return;
    setPending("delete"); setError(null); setNotice(null);
    try {
      await deleteAgent(selected.id);
      setNotice("Agent deleted.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete this agent."); }
    finally { setPending(null); setConfirmingDelete(false); }
  }
  return <ScrollView className="flex-1 bg-app" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 24), maxWidth: 680, width: "100%", alignSelf: "center" }}>
    <View className="mb-4 flex-row items-center justify-between">
      <Pressable accessibilityRole="button" accessibilityLabel="Close bot manager" onPress={() => router.dismissTo("/")} className={CIRCLE}><X size={20} color={ICON} /></Pressable>
      <View className="flex-row gap-2">
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh bots" onPress={() => { void reconnect(); }} className={CIRCLE}><RefreshCw size={18} color={ICON} /></Pressable>
        {settings.spaceId ? <Pressable accessibilityRole="button" accessibilityLabel="Open org chart" onPress={() => router.push("/org-chart")} className={CIRCLE}><Network size={20} color={ICON} /></Pressable> : null}
      </View>
    </View>
    <Text accessibilityRole="header" className="mb-2 px-4 text-[13px] text-ink-secondary">{settings.spaceName ? `Bots · ${settings.spaceName}` : "Bots"}</Text>
    <View className="mb-4 overflow-hidden rounded-3xl bg-panel">
      {!visibleAgents.length ? <Text className="px-4 py-5 text-[15px] text-ink-secondary">No bots yet</Text> : null}
      {groupAgentsBySpace(visibleAgents).map((section, sectionIndex) => <View key={section.id || "default"}>
        {agents.some((agent) => agent.spaceName) ? <Text accessibilityRole="header"
          className={cn("px-4 pb-1 pt-3 text-[13px] text-ink-secondary", sectionIndex > 0 && "border-t border-hairline")}
          numberOfLines={1}>{section.name}</Text> : null}
        {section.agents.map((agent, index) => <Pressable key={agent.id} accessibilityRole="button" accessibilityLabel={`Manage ${agent.name}`} onPress={() => { selectAgent(agent.id); setNotice(null); setError(null); }}
          className="active:bg-raised/40">
          <View className={cn("mx-4 flex-row items-center gap-3 py-3", index > 0 && "border-t border-hairline")}>
            <BlobAvatar name={agent.name} size={44} {...avatarFields(agent)} />
            <View className="min-w-0 flex-1">
              <Text className="text-[17px] text-ink" numberOfLines={1}>{agent.name}</Text>
              {agent.title ? <Text className="mt-0.5 text-[13px] text-ink-secondary" numberOfLines={1}>{agent.title}</Text> : null}
            </View>
            {agent.id === selectedId ? <View className="h-2 w-2 rounded-full bg-success" /> : <ChevronRight size={18} color="#8a8a8a" />}
          </View>
        </Pressable>)}
      </View>)}
      {canManage ? <Pressable accessibilityRole="button" accessibilityLabel="New agent" onPress={startCreate}
        className="min-h-14 flex-row items-center gap-3 border-t border-hairline px-4 active:bg-raised/40">
        <View className={CIRCLE}><Plus size={20} color={ICON} /></View>
        <Text className="flex-1 text-[17px] text-ink">New agent</Text>
      </Pressable> : null}
    </View>
    {selected ? <>
      <Text accessibilityRole="header" className="mb-2 px-4 text-[13px] text-ink-secondary" numberOfLines={1}>{selected.name}</Text>
      <View className="mb-4 overflow-hidden rounded-3xl bg-panel">
        {editing ? <View className="p-4">
          <AgentForm key={selected.id} agent={{ id: selected.id, name: selected.name, description: selected.description ?? "" }}
            onCancel={() => setEditing(false)}
            onSaved={() => { setEditing(false); setNotice("Saved"); }} />
        </View> : <>
          {selected.description || selected.title ? <Text className="px-4 pt-4 text-[15px] leading-6 text-ink">{selected.description || selected.title}</Text> : null}
          {canManage ? <>
            <Pressable accessibilityRole="button" accessibilityLabel="Edit agent" onPress={startEdit} className="active:bg-raised/40">
              <View className="mx-4 min-h-14 flex-row items-center justify-between border-t border-hairline py-3">
                <Text className="text-[17px] text-ink">Edit agent</Text>
                <Pencil size={17} color="#8a8a8a" />
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Delete agent" disabled={pending !== null}
              onPress={() => { setError(null); setNotice(null); setConfirmingDelete(true); }} className="active:bg-raised/40">
              <View className="mx-4 min-h-14 flex-row items-center justify-between border-t border-hairline py-3">
                <Text className="text-[17px] text-ink">Delete agent</Text>
                {pending === "delete" ? <ActivityIndicator size="small" color="#b3b3b3" /> : <Trash2 size={17} color="#ff5667" />}
              </View>
            </Pressable>
          </> : null}
        </>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Open bot conversation" onPress={() => router.dismissTo("/")} className="min-h-12 items-center justify-center rounded-full bg-ink py-3 active:opacity-80">
        <Text className="text-[16px] font-semibold text-app">Open conversation</Text>
      </Pressable>
    </> : null}
    {notice ? <Text accessibilityLiveRegion="polite" className="mt-4 px-4 text-[13px] text-success">{notice}</Text> : null}
    {error ? <Text accessibilityRole="alert" className="mt-4 px-4 text-[13px] text-danger">{error}</Text> : null}
    <Modal transparent visible={creating} animationType="fade" onRequestClose={() => setCreating(false)} statusBarTranslucent>
      <View className="flex-1 items-center justify-center bg-black/60 px-6">
        <View className="w-full max-w-md overflow-hidden rounded-3xl bg-panel">
          <View className="flex-row items-center justify-between px-4 pt-4">
            <Text accessibilityRole="header" className="text-[17px] text-ink">New agent</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close new agent" onPress={() => setCreating(false)} className={SMALL}><X size={18} color={ICON} /></Pressable>
          </View>
          <View className="px-4 pb-4 pt-3">
            {creating ? <AgentForm onCancel={() => setCreating(false)}
              onSaved={(agent) => { selectAgent(agent.id); setCreating(false); router.dismissTo("/"); }} /> : null}
          </View>
        </View>
      </View>
    </Modal>
    <Modal transparent visible={confirmingDelete} animationType="fade" onRequestClose={() => setConfirmingDelete(false)} statusBarTranslucent>
      <View className="flex-1 items-center justify-center bg-black/60 px-6">
        <View className="w-full max-w-sm overflow-hidden rounded-3xl bg-panel">
          <Text accessibilityRole="header" className="px-5 pt-5 text-[17px] text-ink">Delete this agent?</Text>
          <Text className="px-5 pb-5 pt-1 text-[14px] leading-5 text-ink-secondary">This can't be undone.</Text>
          <View className="flex-row border-t border-hairline">
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel delete" disabled={pending !== null}
              onPress={() => setConfirmingDelete(false)} className="min-h-12 flex-1 items-center justify-center active:bg-raised/40">
              <Text className="text-[15px] text-ink-secondary">Cancel</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Confirm delete agent" disabled={pending !== null}
              onPress={() => void removeAgent()} className="min-h-12 flex-1 items-center justify-center border-l border-hairline active:bg-raised/40">
              {pending === "delete" ? <ActivityIndicator size="small" color="#ff5667" /> : <Text className="text-[15px] text-danger">Delete</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  </ScrollView>;
}
