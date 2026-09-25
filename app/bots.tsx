import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Check, ChevronRight, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "@/lib/store";
import { BlobAvatar } from "@/components/BlobAvatar";
import { cn } from "@/lib/cn";
import { agentPath, parseAgentDetail, type ManagedAgent } from "@/lib/agents";

const CIRCLE = "h-11 w-11 items-center justify-center rounded-full bg-raised active:bg-raised-hover";
const SMALL = "h-9 w-9 items-center justify-center rounded-full active:bg-raised-hover";
const ICON = "#d4d4d4";
const ACTIONS = { start: "Start session", stop: "Stop session", new: "New session" } as const;

type AgentForm = { name: string; description: string; computer: boolean; memory: boolean };

export default function BotsScreen() {
  const { agents, selectedId, selectAgent, sessions, sessionAction, reconnect, connection,
    canManage, createAgent, updateAgent, deleteAgent, request } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [managed, setManaged] = useState<ManagedAgent | null>(null);
  const [form, setForm] = useState<AgentForm>({ name: "", description: "", computer: false, memory: false });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const selected = agents.find((row) => row.id === selectedId);
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void sessionAction(selectedId, "status").catch((cause: Error) => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; };
  }, [selectedId, sessionAction]);
  useEffect(() => {
    setEditing(false); setCreating(false); setConfirmingDelete(false); setManaged(null);
  }, [selectedId]);
  async function operate(action: keyof typeof ACTIONS) {
    if (!selected || pending) return;
    setPending(action); setError(null); setNotice(null);
    try {
      await sessionAction(selected.id, action);
      setNotice(action === "stop" ? "The current run has stopped. You can send a message to continue." : action === "new" ? "New session ready. The bot starts with a fresh context." : "Session ready. Open the conversation to send a message.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update this session."); }
    finally { setPending(null); }
  }
  async function startEdit() {
    if (!selected) return;
    setError(null); setNotice(null); setEditing(true);
    try {
      const agent = parseAgentDetail(await request<unknown>(agentPath(selected.id)));
      setManaged(agent);
      setForm({ name: agent.name, description: agent.description, computer: agent.enableComputer, memory: agent.enableMemory });
    } catch (cause) {
      setEditing(false);
      setError(cause instanceof Error ? cause.message : "Could not load this agent.");
    }
  }
  async function saveEdit() {
    if (!selected || !form.name.trim()) return;
    setPending("save"); setError(null); setNotice(null);
    try {
      await updateAgent(selected.id, { name: form.name, description: form.description,
        enableComputer: form.computer, enableMemory: form.memory });
      setEditing(false);
      setNotice("Agent saved. The roster updates in a moment.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this agent."); }
    finally { setPending(null); }
  }
  async function submitCreate() {
    if (!form.name.trim()) return;
    setPending("create"); setError(null); setNotice(null);
    try {
      const agent = await createAgent({ name: form.name, description: form.description,
        enableComputer: form.computer, enableMemory: form.memory });
      setCreating(false);
      setForm({ name: "", description: "", computer: false, memory: false });
      setNotice(`${agent.name} is ready. Open its conversation to start talking.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create this agent."); }
    finally { setPending(null); }
  }
  async function removeAgent() {
    if (!selected) return;
    setPending("delete"); setError(null); setNotice(null);
    try {
      await deleteAgent(selected.id);
      setConfirmingDelete(false);
      setNotice("Agent deleted.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete this agent."); }
    finally { setPending(null); }
  }
  const capabilities = selected?.capabilities
    ? [selected.capabilities.files && "Files", selected.capabilities.desktop && "Desktop", selected.capabilities.interactions && "Questions & approvals"].filter(Boolean).join(" · ") : "";
  const formRows = (value: AgentForm, onChange: (patch: Partial<AgentForm>) => void) => <View>
    <TextInput accessibilityLabel="Agent name" value={value.name} onChangeText={(name) => onChange({ name })}
      placeholder="Agent name" placeholderTextColor="#8a8a8a" maxLength={128}
      className="min-h-11 min-w-0 px-4 text-[17px] text-ink" />
    <TextInput accessibilityLabel="Agent description" value={value.description} onChangeText={(description) => onChange({ description })}
      placeholder="What does this bot do?" placeholderTextColor="#8a8a8a" maxLength={4000} multiline
      className="min-h-11 min-w-0 border-t border-hairline px-4 py-3 text-[15px] text-ink" />
    <Pressable accessibilityRole="button" accessibilityLabel="Toggle computer environment" onPress={() => onChange({ computer: !value.computer })}
      className="min-h-12 flex-row items-center justify-between border-t border-hairline px-4 active:bg-raised/40">
      <Text className="text-[15px] text-ink">Computer</Text>
      <Text className={cn("text-[15px]", value.computer ? "text-success" : "text-ink-secondary")}>{value.computer ? "On" : "Off"}</Text>
    </Pressable>
    <Text className="border-t border-hairline px-4 pb-3 pt-2 text-[13px] text-ink-secondary">Computer enables files, shell, browser and desktop for this agent.</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Toggle memory" onPress={() => onChange({ memory: !value.memory })}
      className="min-h-12 flex-row items-center justify-between border-t border-hairline px-4 active:bg-raised/40">
      <Text className="text-[15px] text-ink">Memory</Text>
      <Text className={cn("text-[15px]", value.memory ? "text-success" : "text-ink-secondary")}>{value.memory ? "On" : "Off"}</Text>
    </Pressable>
  </View>;
  return <ScrollView className="flex-1 bg-app" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 24), maxWidth: 680, width: "100%", alignSelf: "center" }}>
    <View className="mb-4 flex-row items-center justify-between">
      <Pressable accessibilityRole="button" accessibilityLabel="Close bot manager" onPress={() => router.dismissTo("/")} className={CIRCLE}><X size={20} color={ICON} /></Pressable>
      <View className="flex-row gap-2">
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh bots" onPress={() => { void reconnect(); }} className={CIRCLE}><RefreshCw size={18} color={ICON} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Authorize bots" onPress={() => router.push("/login")} className={CIRCLE}><Plus size={22} color={ICON} /></Pressable>
      </View>
    </View>
    <Text accessibilityRole="header" className="mb-2 px-4 text-[13px] text-ink-secondary">Bots</Text>
    <View className="mb-4 overflow-hidden rounded-3xl bg-panel">
      {!agents.length ? <Text className="px-4 py-5 text-[15px] text-ink-secondary">{canManage ? "No agents yet. Create one below." : "No bots yet"}</Text> : null}
      {agents.map((agent, index) => <Pressable key={agent.id} accessibilityRole="button" accessibilityLabel={`Manage ${agent.name}`} onPress={() => { selectAgent(agent.id); setNotice(null); setError(null); }}
        className="active:bg-raised/40">
        <View className={cn("mx-4 flex-row items-center gap-3 py-3", index > 0 && "border-t border-hairline")}>
          <BlobAvatar name={agent.name} color={agent.color} size={44} />
          <View className="min-w-0 flex-1">
            <Text className="text-[17px] text-ink" numberOfLines={1}>{agent.name}</Text>
            {agent.title ? <Text className="mt-0.5 text-[13px] text-ink-secondary" numberOfLines={1}>{agent.title}</Text> : null}
          </View>
          {agent.id === selectedId ? <View className="h-2 w-2 rounded-full bg-success" /> : <ChevronRight size={18} color="#8a8a8a" />}
        </View>
      </Pressable>)}
      {creating ? <View className="border-t border-hairline">
        {formRows(form, (patch) => setForm((previous) => ({ ...previous, ...patch })))}
        <View className="flex-row items-center justify-end gap-2 px-4 pb-3 pt-1">
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel new agent" onPress={() => { setCreating(false); setForm({ name: "", description: "", computer: false, memory: false }); }} className={SMALL}><X size={18} color={ICON} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Create agent" disabled={!form.name.trim() || pending !== null}
            onPress={() => void submitCreate()} className={cn(SMALL, (!form.name.trim() || pending !== null) && "opacity-40")}>
            {pending === "create" ? <ActivityIndicator size="small" color="#b3b3b3" /> : <Check size={18} color="#8ee08e" />}
          </Pressable>
        </View>
      </View> : canManage ? <Pressable accessibilityRole="button" accessibilityLabel="Create agent"
        onPress={() => { setCreating(true); setForm({ name: "", description: "", computer: false, memory: false }); setNotice(null); setError(null); }}
        className="min-h-14 flex-row items-center gap-3 border-t border-hairline px-4 active:bg-raised/40">
        <View className={CIRCLE}><Plus size={20} color={ICON} /></View>
        <Text className="flex-1 text-[17px] text-ink">New agent</Text>
      </Pressable> : null}
    </View>
    {selected ? <>
      <Text accessibilityRole="header" className="mb-2 px-4 text-[13px] text-ink-secondary" numberOfLines={1}>{selected.name}</Text>
      <View className="mb-4 overflow-hidden rounded-3xl bg-panel">
        {editing ? <>
          {formRows(form, (patch) => setForm((previous) => ({ ...previous, ...patch })))}
          <View className="flex-row items-center justify-end gap-2 px-4 pb-3 pt-1">
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel editing" onPress={() => setEditing(false)} className={SMALL}><X size={18} color={ICON} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Save agent" disabled={!form.name.trim() || pending !== null}
              onPress={() => void saveEdit()} className={cn(SMALL, (!form.name.trim() || pending !== null) && "opacity-40")}>
              {pending === "save" ? <ActivityIndicator size="small" color="#b3b3b3" /> : <Check size={18} color="#8ee08e" />}
            </Pressable>
          </View>
        </> : <>
          {selected.description || selected.title ? <Text className="px-4 pt-4 text-[15px] leading-6 text-ink">{selected.description || selected.title}</Text> : null}
          <Text selectable className="px-4 pt-3 text-[13px] text-ink-secondary">Binding: {selected.bindingId ?? sessions[selected.id]?.bindingId ?? "Provided by Zakura"}</Text>
          {capabilities ? <Text className="px-4 pt-1 text-[13px] text-ink-secondary">{capabilities}</Text> : null}
          <Text className="px-4 pb-4 pt-3 text-[15px] text-ink">Session: {sessions[selected.id]?.status?.replace("_", " ") ?? "Loading…"}</Text>
          {(Object.keys(ACTIONS) as Array<keyof typeof ACTIONS>).map((action) => <Pressable key={action} disabled={!!pending || connection !== "connected" || selected.status === "offline"}
            accessibilityRole="button" accessibilityLabel={ACTIONS[action]} onPress={() => void operate(action)} className="active:bg-raised/40">
            <View className="mx-4 min-h-14 flex-row items-center justify-between border-t border-hairline py-3">
              <Text className="text-[17px] text-ink">{ACTIONS[action]}</Text>
              {pending === action ? <ActivityIndicator size="small" color="#b3b3b3" /> : <ChevronRight size={18} color="#8a8a8a" />}
            </View>
          </Pressable>)}
          {canManage ? <>
            <Pressable accessibilityRole="button" accessibilityLabel="Edit agent" onPress={() => void startEdit()} className="active:bg-raised/40">
              <View className="mx-4 min-h-14 flex-row items-center justify-between border-t border-hairline py-3">
                <Text className="text-[17px] text-ink">Edit agent</Text>
                {editing ? <ActivityIndicator size="small" color="#b3b3b3" /> : <Pencil size={17} color="#8a8a8a" />}
              </View>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={confirmingDelete ? "Confirm delete agent" : "Delete agent"}
              disabled={pending !== null} onPress={() => {
                if (!confirmingDelete) { setConfirmingDelete(true); return; }
                void removeAgent();
              }} className="active:bg-raised/40">
              <View className="mx-4 min-h-14 flex-row items-center justify-between border-t border-hairline py-3">
                <Text className={cn("text-[17px]", confirmingDelete ? "text-danger" : "text-ink")}>
                  {confirmingDelete ? "Tap again to delete this agent" : "Delete agent"}</Text>
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
  </ScrollView>;
}
