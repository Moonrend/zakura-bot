import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "@/lib/store";
import { BlobAvatar } from "@/components/BlobAvatar";

export default function BotsScreen() {
  const { agents, selectedId, selectAgent, settings, profiles, sessions, sessionAction, reconnect, connection } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const profile = profiles.find((row) => row.id === settings.profileId);
  const selected = agents.find((row) => row.id === selectedId);
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    void sessionAction(selectedId, "status").catch((cause: Error) => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; };
  }, [selectedId, sessionAction]);
  async function operate(action: "start" | "stop" | "new") {
    if (!selected || pending) return;
    setPending(action); setError(null); setNotice(null);
    try {
      await sessionAction(selected.id, action);
      setNotice(action === "stop" ? "The current run has stopped. You can send a message to continue." : action === "new" ? "New session ready. The bot starts with a fresh context." : "Session ready. Open the conversation to send a message.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update this session."); }
    finally { setPending(null); }
  }
  return <ScrollView className="flex-1 bg-app" contentContainerStyle={{ padding: 20, paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 20), maxWidth: 760, width: "100%", alignSelf: "center" }}>
    <View className="mb-5 flex-row items-center justify-between gap-3">
      <View className="min-w-0 flex-1"><Text accessibilityRole="header" className="text-[24px] font-semibold text-ink">Your bots</Text>
        <Text className="mt-2 text-[13px] text-ink-secondary">{settings.useMockChannel ? "Demo workspace" : profile?.label ?? settings.zakuraBaseUrl} · {agents.length} authorized</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Close bot manager" onPress={() => router.dismissTo("/")} className="min-h-11 justify-center px-3"><Text className="text-ink">Done</Text></Pressable>
    </View>
    <View className="mb-5 flex-row gap-3">
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh bots" onPress={() => { void reconnect(); }} className="min-h-11 justify-center rounded-xl border border-hairline px-4"><Text className="text-ink">Refresh bots</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Authorize more bots" onPress={() => router.push("/login")} className="min-h-11 justify-center rounded-xl border border-hairline px-4"><Text className="text-ink">Authorize bots</Text></Pressable>
    </View>
    {!agents.length ? <Text className="my-5 text-ink-secondary">No bots are available. Add an enabled Zakura Bot binding in your tenant and authorize this device.</Text> : null}
    {agents.map((agent) => <Pressable key={agent.id} accessibilityRole="button" accessibilityLabel={`Manage ${agent.name}`} onPress={() => { selectAgent(agent.id); setNotice(null); setError(null); }}
      className={`mb-2 flex-row items-center gap-3 rounded-2xl border p-4 ${agent.id === selectedId ? "border-accent bg-raised" : "border-hairline bg-panel"}`}>
      <BlobAvatar name={agent.name} color={agent.color} size={42} /><View className="min-w-0 flex-1"><Text className="font-semibold text-ink">{agent.name}</Text>
        <Text className="mt-1 text-[13px] text-ink-secondary">{agent.title ?? "Zakura agent"} · {agent.status}</Text></View>
    </Pressable>)}
    {selected ? <View className="mt-5 gap-3 rounded-2xl border border-hairline bg-panel p-5">
      <Text accessibilityRole="header" className="text-[20px] font-semibold text-ink">{selected.name} details</Text>
      <Text className="text-[14px] leading-6 text-ink-secondary">{selected.description || selected.title || "A bot authorized for this device."}</Text>
      <Text selectable className="text-[12px] text-ink-secondary">Binding: {selected.bindingId ?? sessions[selected.id]?.bindingId ?? "Provided by Zakura"}</Text>
      <Text className="text-[14px] text-ink">Session: {sessions[selected.id]?.status?.replace("_", " ") ?? "Loading…"}</Text>
      {selected.capabilities ? <Text className="text-[13px] text-ink-secondary">{[selected.capabilities.files && "Files", selected.capabilities.desktop && "Desktop", selected.capabilities.interactions && "Questions & approvals"].filter(Boolean).join(" · ")}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Open bot conversation" onPress={() => router.dismissTo("/")} className="min-h-11 items-center justify-center rounded-xl bg-accent p-3"><Text className="font-semibold text-app">Open conversation</Text></Pressable>
      <View className="flex-row flex-wrap gap-3">
        {(["start", "stop", "new"] as const).map((action) => <Pressable key={action} disabled={!!pending || connection !== "connected" || selected.status === "offline"}
          accessibilityRole="button" accessibilityLabel={action === "start" ? "Start session" : action === "stop" ? "Stop session" : "New session"} onPress={() => void operate(action)}
          className="min-h-11 flex-row items-center gap-2 rounded-xl border border-hairline px-4">
          {pending === action ? <ActivityIndicator size="small" /> : null}<Text className="text-ink">{action === "start" ? "Start session" : action === "stop" ? "Stop session" : "New session"}</Text>
        </Pressable>)}
      </View>
      <Text className="text-[12px] leading-5 text-ink-secondary">New session resets the bot’s context. Earlier messages remain in your transcript.</Text>
    </View> : null}
    {notice ? <Text accessibilityLiveRegion="polite" className="mt-4 text-success">{notice}</Text> : null}
    {error ? <Text accessibilityRole="alert" className="mt-4 text-danger">{error}</Text> : null}
  </ScrollView>;
}
