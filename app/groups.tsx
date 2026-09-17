import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "@/lib/store";
import { uid } from "@/lib/channel";
import { botGroupKey, type GroupAction } from "@/lib/groups";

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
  return <ScrollView className="flex-1 bg-app" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 20), maxWidth: 760, width: "100%", alignSelf: "center" }}>
    <View className="mb-3 flex-row items-center justify-between"><Text accessibilityRole="header" className="text-[24px] font-semibold text-ink">Bot groups</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Close groups" className="min-h-11 justify-center px-3" onPress={() => router.dismissTo("/")}><Text className="text-ink">Done</Text></Pressable></View>
    <Text className="mb-6 text-[14px] leading-6 text-ink-secondary">Organize the sidebar for this instance. Groups and their order are saved on this device.</Text>
    <View className="mb-6 flex-row gap-3">
      <TextInput accessibilityLabel="New group name" value={name} onChangeText={setName} placeholder="Group name" placeholderTextColor="#a3a3a3" maxLength={64}
        className="min-h-11 min-w-0 flex-1 rounded-xl border border-hairline bg-panel px-4 py-3 text-ink" />
      <Pressable disabled={disabled || !name.trim()} accessibilityRole="button" accessibilityLabel="Create group" onPress={() => void change({ type: "create", id: uid("group"), name })}
        className="min-h-11 justify-center rounded-xl bg-accent px-4"><Text className="font-semibold text-app">Create</Text></Pressable>
    </View>
    {groups.sections.map((section, index) => <View key={section.id} className="mb-3 gap-3 rounded-2xl border border-hairline bg-panel p-4" testID={`group-${section.id}`}>
      {renaming === section.id ? <View className="flex-row gap-3"><TextInput accessibilityLabel="Rename group" value={renamed} onChangeText={setRenamed} maxLength={64} className="min-h-11 min-w-0 flex-1 rounded-xl border border-hairline px-3 text-ink" />
        <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel="Save group name" onPress={() => void change({ type: "rename", id: section.id, name: renamed })} className="min-h-11 justify-center px-3"><Text className="text-accent">Save</Text></Pressable></View>
        : <Text className="text-[17px] font-semibold text-ink">{section.name}</Text>}
      <View className="flex-row flex-wrap gap-2">
        <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={`Rename ${section.name}`} onPress={() => { setRenaming(section.id); setRenamed(section.name); }} className="min-h-11 justify-center px-3"><Text className="text-ink">Rename</Text></Pressable>
        <Pressable disabled={disabled || index === 0} accessibilityRole="button" accessibilityLabel={`Move ${section.name} up`} onPress={() => void change({ type: "move", id: section.id, direction: -1 })} className="min-h-11 justify-center px-3"><Text className="text-ink">Move up</Text></Pressable>
        <Pressable disabled={disabled || index === groups.sections.length - 1} accessibilityRole="button" accessibilityLabel={`Move ${section.name} down`} onPress={() => void change({ type: "move", id: section.id, direction: 1 })} className="min-h-11 justify-center px-3"><Text className="text-ink">Move down</Text></Pressable>
        <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={`Delete ${section.name}`} onPress={() => void change({ type: "delete", id: section.id })} className="min-h-11 justify-center px-3"><Text className="text-danger">Delete</Text></Pressable>
      </View>
    </View>)}
    <Text accessibilityRole="header" className="mb-3 mt-5 text-[18px] font-semibold text-ink">Place bots in groups</Text>
    {agents.map((agent) => {
      const key = botGroupKey(agent), sectionId = groups.assignments[key];
      return <View key={agent.id} className="mb-3 rounded-2xl border border-hairline bg-panel p-4">
        <Pressable accessibilityRole="button" accessibilityLabel={`Move ${agent.name} to group`} disabled={disabled} onPress={() => setMoving(moving === key ? null : key)} className="min-h-11 justify-center">
          <Text className="font-semibold text-ink">{agent.name}</Text><Text className="mt-1 text-[13px] text-ink-secondary">{groups.sections.find((row) => row.id === sectionId)?.name ?? "Ungrouped"}</Text></Pressable>
        {moving === key ? <View className="mt-3 gap-2">{[{ id: "", name: "Ungrouped" }, ...groups.sections].map((section) => <Pressable key={section.id} disabled={disabled} accessibilityRole="button" accessibilityLabel={`Place ${agent.name} in ${section.name}`}
          onPress={() => void change({ type: "assign", botKey: key, sectionId: section.id || null })} className="min-h-11 justify-center rounded-xl bg-raised px-3"><Text className="text-ink">{section.name}</Text></Pressable>)}</View> : null}
      </View>;
    })}
    {error ? <Text accessibilityRole="alert" className="mt-4 text-danger">{error}</Text> : null}
  </ScrollView>;
}
