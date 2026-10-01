import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Trash2, X } from "lucide-react-native";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { BlobAvatar } from "./BlobAvatar";
import { RoutinesSection } from "./RoutinesSection";
import { ChannelsSection } from "./ChannelsSection";
import { Field } from "@/components/ui/Field";
import { AVATAR_COLORS, AVATAR_SHAPES, avatarFields, avatarShapeId } from "@/lib/avatar";
import { normalizeHttpUrl } from "@/lib/channel/protocol";
import type { Agent } from "@/lib/types";

const ICON = "#d4d4d4";
const CIRCLE = "h-11 w-11 items-center justify-center rounded-full bg-raised active:bg-raised-hover";

type Section = { key: string; title: string; node: ReactNode };

/** Inline text that commits on blur; reverted if the commit rejects. */
function EditableText({ value, placeholder, accessibilityLabel, multiline, required, editable, onCommit }: {
  value: string;
  placeholder: string;
  accessibilityLabel: string;
  multiline?: boolean;
  required?: boolean;
  editable: boolean;
  onCommit: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const editingRef = useRef(false);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  const begin = () => { editingRef.current = true; setEditing(true); };
  const finish = () => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setEditing(false);
    const next = draft.trim();
    if (next === value.trim() || (required && !next)) { setDraft(value); return; }
    setSaving(true);
    void onCommit(next).catch(() => setDraft(value)).finally(() => setSaving(false));
  };
  if (editing) return <TextInput value={draft} onChangeText={setDraft} autoFocus multiline={multiline}
    accessibilityLabel={accessibilityLabel} placeholder={placeholder} placeholderTextColor="#8a8a8a"
    maxLength={multiline ? 4000 : 128} onBlur={finish} onSubmitEditing={finish}
    className={cn("min-w-0 py-1 text-[16px] leading-6 text-ink", multiline && "min-h-16")} />;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} disabled={!editable}
    onPress={begin} className="min-h-7 justify-center py-1 active:opacity-70">
    <View className="flex-row items-center gap-2">
      <Text className={cn("min-w-0 flex-1 text-[16px] leading-6", value ? "text-ink" : "text-ink-secondary")}>{value || placeholder}</Text>
      {saving ? <ActivityIndicator size="small" color="#b3b3b3" /> : null}
    </View>
  </Pressable>;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <View className="mb-4 overflow-hidden rounded-3xl bg-panel">
    <Text accessibilityRole="header" className="px-4 pb-1 pt-3 text-[13px] text-ink-secondary">{title}</Text>
    {children}
  </View>;
}

/** Quiet avatar editor: a Bot tab with shape/color rows and an Upload tab (web) for a public image link. */
function AvatarEditor({ agent, editable, commit }: {
  agent: Agent;
  editable: boolean;
  commit: (draft: { avatarShape?: string; avatarColor?: string; avatarUrl?: string }) => Promise<void>;
}) {
  const [tab, setTab] = useState<"bot" | "upload">("bot");
  const [shape, setShape] = useState(() => avatarShapeId(agent.avatarShape));
  const [color, setColor] = useState(agent.avatarColor || agent.color);
  const [url, setUrl] = useState(agent.avatarUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);

  useEffect(() => {
    setShape(avatarShapeId(agent.avatarShape));
    setColor(agent.avatarColor || agent.color);
    setUrl(agent.avatarUrl ?? "");
    setUrlError(null);
  }, [agent.id, agent.avatarShape, agent.avatarColor, agent.color, agent.avatarUrl]);

  const botDirty = shape !== avatarShapeId(agent.avatarShape) || color !== (agent.avatarColor || agent.color);
  const normalizedUrl = normalizeHttpUrl(url);
  const urlDirty = normalizedUrl !== (agent.avatarUrl ?? null);
  const preview = tab === "upload" ? normalizedUrl : null;

  const saveBot = async () => {
    if (saving || !botDirty) return;
    setSaving(true);
    try { await commit({ avatarShape: shape, avatarColor: color }); }
    catch { /* the pane shows the error */ }
    finally { setSaving(false); }
  };
  const saveUrl = async () => {
    if (saving) return;
    if (!normalizedUrl) { setUrlError("Enter a valid http or https image link."); return; }
    setUrlError(null);
    setSaving(true);
    try { await commit({ avatarUrl: normalizedUrl }); }
    catch { /* the pane shows the error */ }
    finally { setSaving(false); }
  };

  const saveButton = (label: string, disabled: boolean, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
      className={cn("min-h-9 items-center justify-center rounded-xl border border-hairline bg-panel px-4 active:bg-raised/40",
        disabled && "opacity-40")}>
      {saving ? <ActivityIndicator size="small" color="#b3b3b3" /> : <Text className="text-[13px] text-ink">Save</Text>}
    </Pressable>
  );

  return <>
    <View className="items-center pb-3 pt-4">
      <BlobAvatar name={agent.name} size={96} color={color} shape={shape} url={preview} />
    </View>
    {Platform.OS === "web" ? <View className="mx-4 mb-1 flex-row gap-1 self-start rounded-full bg-inset p-0.5">
      {(["bot", "upload"] as const).map((option) => {
        const active = tab === option;
        return <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: active }}
          accessibilityLabel={option === "bot" ? "Bot avatar" : "Upload avatar"} onPress={() => setTab(option)}
          className={cn("rounded-full px-3 py-1.5", active ? "bg-raised" : "active:bg-raised/40")}>
          <Text className={cn("text-[13px]", active ? "text-ink" : "text-ink-secondary")}>{option === "bot" ? "Bot" : "Upload"}</Text>
        </Pressable>;
      })}
    </View> : null}
    {tab === "bot" || Platform.OS !== "web" ? <View className="px-4 pb-4 pt-1">
      {agent.avatarUrl ? <Text className="pb-3 text-[13px] leading-5 text-ink-secondary">
        A linked image is showing instead of this. Paste a new link in Upload to replace it.
      </Text> : null}
      <View className="flex-row flex-wrap gap-2">
        {AVATAR_SHAPES.map((option) => {
          const active = option.id === shape;
          return <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: active }}
            accessibilityLabel={`${option.label} shape`} disabled={!editable} onPress={() => setShape(option.id)}
            className={cn("rounded-2xl border p-1", active ? "border-ink" : "border-transparent active:bg-raised/40")}>
            <BlobAvatar name={agent.name} size={30} color={color} shape={option.id} />
          </Pressable>;
        })}
      </View>
      <View className="mt-3 flex-row flex-wrap gap-1.5">
        {AVATAR_COLORS.map((option) => {
          const active = option.value === color;
          return <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: active }}
            accessibilityLabel={`${option.label} color`} disabled={!editable} onPress={() => setColor(option.value)}
            className={cn("h-9 w-9 items-center justify-center rounded-full border-2", active ? "border-ink" : "border-transparent")}>
            <View className="h-7 w-7 rounded-full" style={{ backgroundColor: option.value }} />
          </Pressable>;
        })}
      </View>
      {editable ? <View className="mt-4 flex-row justify-end">
        {saveButton("Save avatar", saving || !botDirty, () => void saveBot())}
      </View> : null}
    </View> : <View className="px-4 pb-4 pt-1">
      <Text className="text-[13px] leading-5 text-ink-secondary">
        Zakura keeps uploaded files private to this app, so they can't load as an avatar. Paste a public image link instead.
      </Text>
      <View className="mt-3">
        <Field label="Image URL" value={url} onChangeText={setUrl} editable={editable}
          placeholder="https://example.com/avatar.png" autoCapitalize="none" autoCorrect={false}
          keyboardType="url" error={urlError ?? undefined} />
      </View>
      {editable ? <View className="mt-4 flex-row justify-end">
        {saveButton("Save avatar image", saving || !urlDirty, () => void saveUrl())}
      </View> : null}
    </View>}
  </>;
}

export function AgentInfoPane({ agentId, onClose }: { agentId?: string; onClose: () => void }) {
  const { agents, selectedId, canManage, settings, updateAgent, deleteAgent } = useStore();
  const agent = agents.find((row) => row.id === (agentId ?? selectedId));
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { setConfirmingDelete(false); setError(null); }, [agent?.id]);

  const commitField = (field: "name" | "description") => async (next: string) => {
    if (!agent) return;
    setError(null);
    try { await updateAgent(agent.id, field === "name" ? { name: next } : { description: next }); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this agent.");
      throw cause;
    }
  };
  const commitAvatar = async (draft: { avatarShape?: string; avatarColor?: string; avatarUrl?: string }) => {
    if (!agent) return;
    setError(null);
    try { await updateAgent(agent.id, draft); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the avatar.");
      throw cause;
    }
  };
  const remove = async () => {
    if (!agent || deleting) return;
    setDeleting(true); setError(null);
    try { await deleteAgent(agent.id); onClose(); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete this agent.");
      setDeleting(false);
    }
  };

  const sections: Section[] = [];
  if (agent) {
    sections.push({
      key: "details",
      title: "Agent",
      node: <>
        <View className="mx-4 flex-row items-center gap-3 border-b border-hairline py-3">
          <BlobAvatar name={agent.name} size={44} {...avatarFields(agent)} />
          <View className="min-w-0 flex-1">
            <Text className="text-[12px] text-ink-secondary">Name</Text>
            <EditableText value={agent.name} placeholder="Agent name" accessibilityLabel="Edit agent name"
              required editable={canManage} onCommit={commitField("name")} />
          </View>
        </View>
        <View className="mx-4 border-b border-hairline py-3">
          <Text className="text-[12px] text-ink-secondary">Description</Text>
          <EditableText value={agent.description ?? ""} placeholder="Add a description" accessibilityLabel="Edit agent description"
            multiline editable={canManage} onCommit={commitField("description")} />
        </View>
        <View className="mx-4 min-h-14 flex-row items-center justify-between gap-3 py-3">
          <Text className="text-[15px] text-ink">Space</Text>
          <Text className="min-w-0 flex-1 text-right text-[15px] text-ink-secondary" numberOfLines={1}>{agent.spaceName || "Default"}</Text>
        </View>
      </>,
    });
    sections.push({
      key: "avatar",
      title: "Avatar",
      node: <AvatarEditor agent={agent} editable={canManage} commit={commitAvatar} />,
    });
    sections.push({
      key: "routines",
      title: "Routines",
      node: settings.useMockChannel
        ? <Text className="px-4 pb-4 pt-1 text-[13px] leading-5 text-ink-secondary">Connect a Zakura instance to use routines.</Text>
        : <RoutinesSection agentId={agent.id} canManage={canManage} />,
    });
    sections.push({
      key: "channels",
      title: "Channels",
      node: settings.useMockChannel
        ? <Text className="px-4 pb-4 pt-1 text-[13px] leading-5 text-ink-secondary">Connect a Zakura instance to use channels.</Text>
        : <ChannelsSection agentId={agent.id} canManage={canManage} />,
    });
    if (canManage) sections.push({
      key: "delete",
      title: "Delete",
      node: confirmingDelete ? <View className="px-4 pb-4 pt-1">
        <Text className="text-[15px] text-ink">Delete this agent?</Text>
        <Text className="mt-1 text-[13px] text-ink-secondary">This can’t be undone.</Text>
        <View className="mt-4 flex-row items-center justify-end gap-2">
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel delete" disabled={deleting}
            onPress={() => setConfirmingDelete(false)} className="min-h-11 justify-center rounded-xl border border-hairline bg-panel px-4 active:bg-raised/40">
            <Text className="text-[13px] text-ink">Cancel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Confirm delete agent" disabled={deleting}
            onPress={() => void remove()} className={cn("min-h-11 flex-row items-center justify-center gap-2 rounded-xl border border-hairline bg-panel px-4 active:bg-raised/40", deleting && "opacity-50")}>
            {deleting ? <ActivityIndicator size="small" color="#ff5667" /> : <Trash2 size={15} color="#ff5667" />}
            <Text className="text-[13px] font-medium text-danger">Delete</Text>
          </Pressable>
        </View>
      </View> : <Pressable accessibilityRole="button" accessibilityLabel="Delete agent" onPress={() => setConfirmingDelete(true)} className="active:bg-raised/40">
        <View className="mx-4 min-h-14 flex-row items-center justify-between gap-3 py-3">
          <Text className="text-[17px] text-ink">Delete agent</Text>
          <Trash2 size={17} color="#ff5667" />
        </View>
      </Pressable>,
    });
  }

  return <View className="min-h-0 flex-1 bg-app">
    <View className="flex-row items-center justify-between px-4 pb-1 pt-3">
      <Text accessibilityRole="header" className="text-[17px] font-semibold text-ink">Info</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Close info" onPress={onClose} className={CIRCLE}>
        <X size={20} color={ICON} />
      </Pressable>
    </View>
    <ScrollView className="min-h-0 flex-1" keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
      {agent ? sections.map((section) => <Card key={section.key} title={section.title}>{section.node}</Card>)
        : <Card title="Agent"><Text className="px-4 pb-4 pt-1 text-[15px] text-ink-secondary">This agent is no longer available.</Text></Card>}
      {error ? <Text accessibilityRole="alert" className="px-4 pb-2 text-[13px] text-danger">{error}</Text> : null}
    </ScrollView>
  </View>;
}
