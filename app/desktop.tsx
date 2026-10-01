import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Image, Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Maximize2, Monitor, Play, RefreshCw, X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "@/lib/store";
import { desktopPhase, desktopPath, parseDesktopInfo, workspaceOffline, type DesktopInfo } from "@/lib/desktop";
import { blobDataUrl } from "@/lib/media";
import { MAX_FILE_BYTES } from "@/lib/files";
import { ZakuraApiError } from "@/lib/auth";
import { TerminalPanel } from "@/components/TerminalPanel";
import type { Agent } from "@/lib/types";

function DesktopView({ agent }: { agent: Agent }) {
  const { request, requestBinary, settings } = useStore();
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const infoRef = useRef<DesktopInfo | null>(null);
  const [frame, setFrame] = useState<{ uri: string; capturedAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const hasFrame = useRef(false);
  const focused = useRef(false);
  const foreground = useRef(true);
  const enabled = !settings.useMockChannel && !!agent.capabilities?.desktop;
  useEffect(() => { if (!enabled) { hasFrame.current = false; setFrame(null); setFullscreen(false); infoRef.current = null; setInfo(null); setAutomatic(false); } }, [enabled]);
  useEffect(() => { if (!frame) setFullscreen(false); }, [frame]);

  const refresh = useCallback(async (recheckInfo = false, force = false) => {
    if (!enabled || pending.current || !focused.current || !foreground.current) return;
    const controller = new AbortController(); pending.current = controller;
    setLoading(true); setError(null);
    try {
      let details = infoRef.current;
      if (!details || recheckInfo) {
        details = parseDesktopInfo(await request(desktopPath(agent.id), { signal: controller.signal }));
        if (controller.signal.aborted) return;
        infoRef.current = details; setInfo(details);
      }
      if (!details.enabled || !details.supported) { hasFrame.current = false; setFrame(null); return; }
      if (!force && !hasFrame.current && workspaceOffline(details.status)) { setFrame(null); return; }
      const data = await requestBinary(desktopPath(agent.id, true), { signal: controller.signal });
      if (!/^image\/png(?:;|$)/i.test(data.contentType) || !data.blob.size || data.blob.size > MAX_FILE_BYTES) throw new Error("Zakura did not return a complete desktop image. Try refreshing.");
      const uri = await blobDataUrl(data.blob);
      if (!controller.signal.aborted) { hasFrame.current = true; setFrame({ uri, capturedAt: data.capturedAt && Number.isFinite(Date.parse(data.capturedAt)) ? Date.parse(data.capturedAt) : Date.now() }); }
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof ZakuraApiError && [401, 403, 409].includes(cause.status)) { hasFrame.current = false; setFrame(null); setAutomatic(false); }
      setError(cause instanceof Error ? cause.message : "Could not capture the desktop.");
    } finally {
      if (pending.current === controller) { pending.current = null; if (!controller.signal.aborted) setLoading(false); }
    }
  }, [enabled, agent.id, request, requestBinary]);

  useFocusEffect(useCallback(() => {
    focused.current = true; void refresh(true);
    return () => { focused.current = false; pending.current?.abort(); pending.current = null; };
  }, [refresh]));
  useEffect(() => {
    const sync = () => {
      foreground.current = Platform.OS === "web" ? document.visibilityState !== "hidden" : AppState.currentState === "active";
      if (!foreground.current) { pending.current?.abort(); pending.current = null; setLoading(false); }
      else if (automatic) void refresh();
    };
    const subscription = AppState.addEventListener("change", sync);
    if (Platform.OS === "web") document.addEventListener("visibilitychange", sync);
    sync();
    return () => { subscription.remove(); if (Platform.OS === "web") document.removeEventListener("visibilitychange", sync); };
  }, [automatic, refresh]);
  useEffect(() => {
    if (!automatic || !enabled) return;
    const timer = setInterval(() => void refresh(), info?.suggestedIntervalMs ?? 2000);
    return () => clearInterval(timer);
  }, [automatic, enabled, info?.suggestedIntervalMs, refresh]);
  useEffect(() => {
    if (Platform.OS !== "web" || !fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  const unavailable = settings.useMockChannel ? "Connect a Zakura instance to view your bot’s desktop."
    : !enabled || info?.enabled === false ? "Enable Computer for this bot in Zakura, then reconnect to view its desktop."
    : info?.supported === false ? "This bot’s runtime does not support a desktop. Choose a runtime with Computer support in Zakura." : null;
  const phase = desktopPhase({ status: info?.status, hasFrame: !!frame, loading });
  return <View className="gap-4">
    <View className="flex-row flex-wrap items-center gap-3">
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh desktop" disabled={!enabled || loading} onPress={() => void refresh(true)} className="min-h-11 flex-row items-center gap-2 rounded-xl bg-accent px-4">
        {loading ? <ActivityIndicator size="small" color="#fcfcfc" /> : <RefreshCw size={16} color="#fcfcfc" />}<Text className="font-semibold text-ink">{loading ? "Refreshing…" : "Refresh"}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={automatic ? "Pause desktop updates" : "Enable desktop updates"} disabled={!enabled || !!unavailable}
        onPress={() => setAutomatic((value) => !value)} className="min-h-11 justify-center rounded-xl border border-hairline px-4"><Text className="text-ink">{automatic ? "Pause" : "Auto"}</Text></Pressable>
      {frame ? <Pressable accessibilityRole="button" accessibilityLabel="Open computer fullscreen" onPress={() => setFullscreen(true)} className="min-h-11 flex-row items-center gap-2 rounded-xl border border-hairline px-4">
        <Maximize2 size={16} color="#d4d4d4" /><Text className="text-ink">Open computer</Text></Pressable> : null}
    </View>
    {error ? <Text accessibilityRole="alert" className="text-danger">{error}</Text> : null}
    {unavailable ? <View className="min-h-64 items-center justify-center gap-4">
      <Monitor size={28} color="#a3a3a3" />
      <Text className="text-center text-[14px] text-ink-secondary">{unavailable}</Text>
    </View> : frame ? <View className="overflow-hidden rounded-xl border border-hairline bg-inset">
      <Image testID="desktop-frame" source={{ uri: frame.uri }} resizeMode="contain" accessibilityLabel={`${agent.name} desktop screenshot`}
        style={{ width: "100%", aspectRatio: info?.width && info?.height ? info.width / info.height : 16 / 9 }} />
      <Text className="px-4 py-3 text-[12px] text-ink-secondary">Captured {new Date(frame.capturedAt).toLocaleTimeString()}{info?.width && info.height ? ` · ${info.width} × ${info.height}` : ""}</Text>
    </View> : phase === "starting" ? <View className="min-h-64 items-center justify-center gap-4">
      <ActivityIndicator color="#1084fe" />
      <Text className="text-center text-[14px] text-ink-secondary">Starting…</Text>
    </View> : <View className="min-h-64 items-center justify-center gap-4">
      <Monitor size={28} color="#a3a3a3" />
      <Text className="text-center text-[14px] text-ink-secondary">This agent’s computer is off.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Start computer" disabled={loading}
        onPress={() => void refresh(true, true)} className="min-h-11 flex-row items-center gap-2 rounded-xl bg-accent px-4">
        <Play size={16} color="#fcfcfc" /><Text className="font-semibold text-ink">Start computer</Text></Pressable>
    </View>}
    <Modal visible={fullscreen && !!frame} transparent animationType="fade" onRequestClose={() => setFullscreen(false)} statusBarTranslucent>
      <View className="flex-1 items-center justify-center bg-black/95" accessibilityViewIsModal>
        {frame ? <Image source={{ uri: frame.uri }} resizeMode="contain" accessibilityLabel={`${agent.name} desktop screenshot, fullscreen`} style={{ width: "100%", height: "100%" }} /> : null}
        {frame ? <Text className="absolute bottom-4 left-4 text-[12px] text-ink-secondary">Captured {new Date(frame.capturedAt).toLocaleTimeString()}</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Close fullscreen desktop" onPress={() => setFullscreen(false)}
          className="absolute right-4 top-4 h-10 w-10 items-center justify-center rounded-full bg-raised active:bg-raised-hover"><X size={20} color="#fcfcfc" /></Pressable>
      </View>
    </Modal>
  </View>;
}

/** Desktop-web only: compact and native layouts skip the terminal entirely. */
function DesktopTerminal({ agentId }: { agentId: string }) {
  const { width } = useWindowDimensions();
  if (Platform.OS !== "web" || width < 768) return null;
  return <View className="mt-6"><TerminalPanel key={agentId} agentId={agentId} /></View>;
}

export default function DesktopScreen() {
  const { agents, selectedId, settings, connection } = useStore();
  const params = useLocalSearchParams<{ agentId?: string }>();
  const agentId = typeof params.agentId === "string" ? params.agentId : selectedId;
  const agent = agents.find((item) => item.id === agentId);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return <ScrollView className="flex-1 bg-app" contentContainerStyle={{ padding: 20, paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 20), maxWidth: 1200, width: "100%", alignSelf: "center" }}>
    <View className="mb-5 flex-row items-center justify-between gap-3"><Text accessibilityRole="header" className="min-w-0 flex-1 text-[20px] font-semibold text-ink">{agent ? agent.name : "Desktop"}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Close desktop" onPress={() => router.dismissTo("/")} className="min-h-11 justify-center px-3"><Text className="text-ink">Done</Text></Pressable></View>
    {agent ? <>
      <DesktopView key={`${settings.profileId ?? settings.useMockChannel}:${agent.id}`} agent={agent} />
      <DesktopTerminal agentId={agent.id} />
    </> : <Text className="text-ink-secondary">{connection === "connecting" ? "Connecting…" : "Unavailable"}</Text>}
  </ScrollView>;
}
