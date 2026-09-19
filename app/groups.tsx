import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ArrowDown, ArrowUp, Check, Pencil, Trash2, X } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "@/lib/store";
import { uid } from "@/lib/channel";
import { botGroupKey, type GroupAction } from "@/lib/groups";
import { cn } from "@/lib/cn";

const CIRCLE = "h-11 w-11 items-center justify-center rounded-full bg-raised active:bg-raised-hover";
const SMALL = "h-11 w-11 items-center justify-center rounded-full active:bg-raised";
const ICON = "#d4d4d4";

export default function GroupsScreen() {
  const { agents, groups, groupsReady, updateGroups } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renamed, setRenamed] = useState("");
  const [moving, setMoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function change(action: GroupAction) {
    setError(null); setSaving(true);
    try { await updateGroups(action); setRenaming(null); setMoving(null); if (action.type === "create") setName(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save groups."); }
    finally { setSaving(false); }
  }
  const disabled = saving || !groupsReady;
  return <ScrollView className="flex-1 bg-app" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 24), maxWidth: 680, width: "100%", alignSelf: "center" }}>
    <View className="mb-4 flex-row items-center">
      <Pressable accessibilityRole="button" accessibilityLabel="Close groups" className={CIRCLE} onPress={() => router.dismissTo("/")}><X size={20} color={ICON} /></Pressable>
    </View>
    <Text accessibilityRole="header" className="mb-2 px-4 text-[13px] text-ink-secondary">Groups</Text>
    <View className="mb-4 overflow-hidden rounded-3xl bg-panel">
      <View className="mx-4 min-h-14 flex-row items-center gap-3 py-2">
        <TextInput accessibilityLabel="New group name" value={name} onChangeText={setName} placeholder="New group" placeholderTextColor="#8a8a8a" maxLength={64}
          className="min-h-11 min-w-0 flex-1 text-[17px] text-ink" />
        <Pressable disabled={disabled || !name.trim()} accessibilityRole="button" accessibilityLabel="Create group" onPress={() => void change({ type: "create", id: uid("group"), name })}
          className={cn("min-h-10 justify-center rounded-full bg-ink px-4", (disabled || !name.trim()) && "opacity-40")}><Text className="font-semibold text-app">Create</Text></Pressable>
      </View>
      {groups.sections.map((section, index) => <View key={section.id} className="mx-4 min-h-14 flex-row items-center gap-1 border-t border-hairline py-2" testID={`group-${section.id}`}>
        {renaming === section.id ? <>
          <TextInput accessibilityLabel="Rename group" value={renamed} onChangeText={setRenamed} maxLength={64} className="min-h-11 min-w-0 flex-1 text-[17px] text-ink" />
          <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel="Save group name" onPress={() => void change({ type: "rename", id: section.id, name: renamed })} className={SMALL}><Check size={18} color={ICON} /></Pressable>
        </> : <>
          <Text className="min-w-0 flex-1 text-[17px] text-ink" numberOfLines={1}>{section.name}</Text>
          <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={`Rename ${section.name}`} onPress={() => { setRenaming(section.id); setRenamed(section.name); }} className={SMALL}><Pencil size={16} color={ICON} /></Pressable>
          <Pressable disabled={disabled || index === 0} accessibilityRole="button" accessibilityLabel={`Move ${section.name} up`} onPress={() => void change({ type: "move", id: section.id, direction: -1 })} className={cn(SMALL, index === 0 && "opacity-30")}><ArrowUp size={16} color={ICON} /></Pressable>
          <Pressable disabled={disabled || index === groups.sections.length - 1} accessibilityRole="button" accessibilityLabel={`Move ${section.name} down`} onPress={() => void change({ type: "move", id: section.id, direction: 1 })} className={cn(SMALL, index === groups.sections.length - 1 && "opacity-30")}><ArrowDown size={16} color={ICON} /></Pressable>
          <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={`Delete ${section.name}`} onPress={() => void change({ type: "delete", id: section.id })} className={SMALL}><Trash2 size={16} color="#ff5667" /></Pressable>
        </>}
      </View>)}
    </View>
    <Text accessibilityRole="header" className="mb-2 px-4 text-[13px] text-ink-secondary">Bots</Text>
    <View className="mb-4 overflow-hidden rounded-3xl bg-panel">
      {agents.map((agent, index) => {
        const key = botGroupKey(agent), sectionId = groups.assignments[key];
        return <View key={agent.id} className={cn("mx-4", index > 0 && "border-t border-hairline")}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Move ${agent.name} to group`} disabled={disabled} onPress={() => setMoving(moving === key ? null : key)}
            className="min-h-14 flex-row items-center justify-between gap-3 py-3">
            <Text className="min-w-0 flex-1 text-[17px] text-ink" numberOfLines={1}>{agent.name}</Text>
            <Text className="text-[15px] text-ink-secondary" numberOfLines={1}>{groups.sections.find((row) => row.id === sectionId)?.name ?? "Ungrouped"}</Text>
          </Pressable>
          {moving === key ? <View className="flex-row flex-wrap gap-2 pb-3">{[{ id: "", name: "Ungrouped" }, ...groups.sections].map((section) => <Pressable key={section.id} disabled={disabled} accessibilityRole="button" accessibilityLabel={`Place ${agent.name} in ${section.name}`}
            onPress={() => void change({ type: "assign", botKey: key, sectionId: section.id || null })}
            className={cn("min-h-10 justify-center rounded-full px-4", (section.id || undefined) === sectionId ? "bg-ink" : "bg-raised")}>
            <Text className={(section.id || undefined) === sectionId ? "font-semibold text-app" : "text-ink"}>{section.name}</Text></Pressable>)}</View> : null}
        </View>;
      })}
    </View>
    {error ? <Text accessibilityRole="alert" className="mt-2 px-4 text-[13px] text-danger">{error}</Text> : null}
  </ScrollView>;
}
