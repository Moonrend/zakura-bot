import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Check, ChevronDown, ChevronUp } from "lucide-react-native";
import { Field } from "@/components/ui/Field";
import { BlobAvatar } from "@/components/BlobAvatar";
import { useStore } from "@/lib/store";
import { agentNameError, resolveSpaceId, type AgentDraft, type ManagedAgent } from "@/lib/agents";
import { AVATAR_COLORS, AVATAR_SHAPES, DEFAULT_AVATAR_COLOR, DEFAULT_AVATAR_SHAPE } from "@/lib/avatar";
import { cn } from "@/lib/cn";

const ROSTER_TIMEOUT_MS = 10_000;

/** Shared create/edit form. Creation waits for the roster frame before reporting success. */
export function AgentForm({ agent, onSaved, onCancel }: {
  agent?: { id: string; name: string; description: string } | null;
  onSaved: (agent: ManagedAgent) => void;
  onCancel: () => void;
}) {
  const { agents, spaces, settings, createAgent, updateAgent } = useStore();
  const editing = !!agent;
  const [name, setName] = useState(agent?.name ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<ManagedAgent | null>(null);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarShape, setAvatarShape] = useState<string>(DEFAULT_AVATAR_SHAPE);
  const [avatarColor, setAvatarColor] = useState<string>(DEFAULT_AVATAR_COLOR);
  const [avatarTouched, setAvatarTouched] = useState(false);
  const [avatarWarning, setAvatarWarning] = useState<string | null>(null);

  const showSpaces = !editing && spaces.length > 0;
  const selectedSpaceId = spaceId && spaces.some((space) => space.id === spaceId)
    ? spaceId : resolveSpaceId(spaces, settings.spaceId ?? null);
  const nameProblem = agentNameError(name);

  // The roster frame is the source of truth: report success only once it lists the agent.
  useEffect(() => {
    if (created && agents.some((row) => row.id === created.id)) onSaved(created);
  }, [created, agents, onSaved]);
  useEffect(() => {
    if (!created) return;
    const timer = setTimeout(() => setSlow(true), ROSTER_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [created]);

  async function submit() {
    if (pending) return;
    if (nameProblem) { setAttempted(true); return; }
    setPending(true); setError(null);
    try {
      if (editing && agent) {
        onSaved(await updateAgent(agent.id, { name: name.trim(), description: description.trim() }));
        return;
      }
      const draft: AgentDraft = { name: name.trim(), description: description.trim(), createApiKey: false };
      if (showSpaces && selectedSpaceId) draft.spaceId = selectedSpaceId;
      const row = await createAgent(draft);
      if (avatarTouched) {
        try { await updateAgent(row.id, { avatarShape, avatarColor }); }
        catch (cause) { setAvatarWarning(cause instanceof Error ? cause.message : "The avatar could not be saved."); }
      }
      setCreated(row);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message
        : editing ? "Could not save this agent." : "Could not create this agent.");
    } finally {
      setPending(false);
    }
  }

  if (created) {
    return <View className="items-center gap-3 py-8">
      {!slow ? <ActivityIndicator color="#a8a8a8" /> : null}
      <Text accessibilityLiveRegion="polite" className="text-[15px] text-ink">
        {slow ? "Still waiting for the agent to appear." : "Adding the agent…"}
      </Text>
      {slow ? <>
        <Text className="text-center text-[13px] leading-5 text-ink-secondary">
          {created.name} was created. The list hasn't caught up yet — continue and it will show up once it syncs.
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Continue" onPress={() => onSaved(created)}
          className="mt-1 min-h-11 items-center justify-center rounded-full bg-ink px-6 py-3 active:opacity-80">
          <Text className="text-[15px] font-semibold text-app">Continue</Text>
        </Pressable>
      </> : null}
      {avatarWarning ? <Text accessibilityRole="alert" className="text-center text-[13px] leading-5 text-danger">{avatarWarning}</Text> : null}
    </View>;
  }

  return <View className="gap-4">
    <Field label="Name" value={name} onChangeText={(value) => { setName(value); if (attempted) setAttempted(false); }}
      placeholder="Agent name" maxLength={120} autoCapitalize="none" autoCorrect={false}
      error={attempted ? nameProblem ?? undefined : undefined} />
    <Field label="Description" value={description} onChangeText={setDescription} placeholder="What should this agent do?"
      maxLength={4000} multiline style={{ minHeight: 88, textAlignVertical: "top" }} />
    {!editing ? <View className="overflow-hidden rounded-2xl bg-inset">
      <Pressable accessibilityRole="button" accessibilityLabel="Customize avatar"
        accessibilityState={{ expanded: avatarOpen }} onPress={() => setAvatarOpen((open) => !open)} className="active:bg-raised/40">
        <View className="mx-4 min-h-12 flex-row items-center gap-3 py-3">
          <BlobAvatar name={name || "?"} size={28} color={avatarColor} shape={avatarShape} />
          <Text className="flex-1 text-[15px] text-ink">Customize avatar</Text>
          {avatarOpen ? <ChevronUp size={18} color="#8a8a8a" /> : <ChevronDown size={18} color="#8a8a8a" />}
        </View>
      </Pressable>
      {avatarOpen ? <View className="mx-4 border-t border-hairline pb-4 pt-3">
        <View className="flex-row flex-wrap gap-2">
          {AVATAR_SHAPES.map((option) => {
            const active = option.id === avatarShape;
            return <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: active }}
              accessibilityLabel={`${option.label} shape`}
              onPress={() => { setAvatarShape(option.id); setAvatarTouched(true); }}
              className={cn("rounded-2xl border p-1", active ? "border-ink" : "border-transparent active:bg-raised/40")}>
              <BlobAvatar name={name || "?"} size={30} color={avatarColor} shape={option.id} />
            </Pressable>;
          })}
        </View>
        <View className="mt-3 flex-row flex-wrap gap-1.5">
          {AVATAR_COLORS.map((option) => {
            const active = option.value === avatarColor;
            return <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: active }}
              accessibilityLabel={`${option.label} color`}
              onPress={() => { setAvatarColor(option.value); setAvatarTouched(true); }}
              className={cn("h-9 w-9 items-center justify-center rounded-full border-2", active ? "border-ink" : "border-transparent")}>
              <View className="h-7 w-7 rounded-full" style={{ backgroundColor: option.value }} />
            </Pressable>;
          })}
        </View>
      </View> : null}
    </View> : null}
    {showSpaces ? <View className="overflow-hidden rounded-2xl bg-inset">
      <Text accessibilityRole="header" className="px-4 pb-1 pt-3 text-[13px] text-ink-secondary">Space</Text>
      {spaces.map((space, index) => {
        const active = selectedSpaceId === space.id;
        return <Pressable key={space.id} accessibilityRole="button" accessibilityLabel={`Create in ${space.name}`}
          onPress={() => setSpaceId(space.id)} className="active:bg-raised/40">
          <View className={cn("mx-4 min-h-12 flex-row items-center justify-between gap-4 py-3", index > 0 && "border-t border-hairline")}>
            <View className="min-w-0 flex-1">
              <Text className="text-[15px] text-ink" numberOfLines={1}>{space.name}</Text>
              <Text className="mt-0.5 text-[13px] text-ink-secondary" numberOfLines={1}>
                {space.agentCount} {space.agentCount === 1 ? "agent" : "agents"}
              </Text>
            </View>
            {active ? <Check size={18} color="#fcfcfc" /> : null}
          </View>
        </Pressable>;
      })}
    </View> : null}
    {error ? <Text accessibilityRole="alert" className="px-2.5 text-[13px] leading-5 text-danger">{error}</Text> : null}
    <View className="flex-row items-center gap-3 pt-1">
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel" disabled={pending} onPress={onCancel}
        className="min-h-11 flex-1 items-center justify-center rounded-full active:bg-raised/40">
        <Text className="text-[15px] text-ink-secondary">Cancel</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={editing ? "Save changes" : "Create agent"} disabled={pending}
        onPress={() => void submit()} className={cn("min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-full bg-ink py-3 active:opacity-80", pending && "opacity-60")}>
        {pending ? <ActivityIndicator size="small" color="#070707" /> : null}
        <Text className="text-[15px] font-semibold text-app">{editing ? "Save changes" : "Create agent"}</Text>
      </Pressable>
    </View>
  </View>;
}
