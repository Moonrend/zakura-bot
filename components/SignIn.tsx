import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { instanceUrl, pollAuthorization, startAuthorization, ZakuraApiError, type DeviceAuthorization } from "@/lib/auth";
import { useStore } from "@/lib/store";

export function SignIn() {
  const { settings, updateSettings, finishSignIn, profiles, switchInstance, authNotice } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState(settings.zakuraBaseUrl);
  const [name, setName] = useState(`Zakura Bot · ${Platform.OS}`);
  const [grant, setGrant] = useState<{ data: DeviceAuthorization; baseUrl: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startRef = useRef<AbortController | null>(null);

  useEffect(() => () => { startRef.current?.abort(); }, []);
  useEffect(() => {
    if (!grant) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let delay = grant.data.interval * 1000;
    const poll = async () => {
      if (Date.now() >= grant.expiresAt) { setGrant(null); setError("This authorization code expired. Start a new login."); return; }
      try {
        const tokens = await pollAuthorization(grant.baseUrl, grant.data.device_code, controller.signal);
        if (controller.signal.aborted) return;
        await finishSignIn(grant.baseUrl, tokens);
        if (!controller.signal.aborted) { setGrant(null); router.replace("/"); }
        return;
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof ZakuraApiError) {
          if (cause.code === "slow_down") delay += 5000;
          else if (cause.code !== "authorization_pending") {
            setGrant(null); setError(cause.code === "access_denied" ? "Authorization was declined. You can start again." : cause.message); return;
          }
        } else setError("Waiting for Zakura. Check your connection; this login will retry automatically.");
      }
      timer = setTimeout(() => void poll(), delay);
    };
    timer = setTimeout(() => void poll(), delay);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [grant, finishSignIn, router]);

  async function begin() {
    if (busy) return;
    let popup: Window | null = null;
    try {
      const baseUrl = instanceUrl(url);
      if (!name.trim()) throw new Error("Give this device a name.");
      if (Platform.OS === "web") { popup = window.open("about:blank", "_blank"); if (popup) popup.opener = null; }
      setBusy(true); setError(null); setGrant(null);
      const controller = new AbortController(); startRef.current = controller;
      const data = await startAuthorization(baseUrl, name.trim(), controller.signal);
      if (controller.signal.aborted) { popup?.close(); return; }
      setGrant({ data, baseUrl, expiresAt: Date.now() + data.expires_in * 1000 });
      if (popup) popup.location.href = data.verification_uri_complete;
      else if (Platform.OS !== "web") void WebBrowser.openBrowserAsync(data.verification_uri_complete);
    } catch (cause) {
      popup?.close();
      setError(cause instanceof Error ? cause.message : "Could not start Zakura login.");
    } finally { setBusy(false); }
  }
  async function choose(id: string) {
    try { await switchInstance(id); router.replace("/"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Sign in again."); }
  }
  return <ScrollView className="flex-1 bg-app" keyboardShouldPersistTaps="handled"
    contentContainerStyle={{ padding: 24, paddingTop: Math.max(insets.top, 48), paddingBottom: Math.max(insets.bottom, 24), maxWidth: 560, width: "100%", alignSelf: "center" }}>
    <Text className="text-[28px] font-semibold text-ink" accessibilityRole="header">Connect to Zakura</Text>
    <Text className="mb-7 mt-3 text-[15px] leading-6 text-ink-secondary">Sign in to your instance, choose your bots, and bring their conversations with you.</Text>
    <Text className="mb-2 text-[14px] text-ink">Zakura instance URL</Text>
    <TextInput value={url} onChangeText={setUrl} editable={!busy && !grant} accessibilityLabel="Zakura instance URL"
      autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://zakura.example.com" placeholderTextColor="#a3a3a3"
      className="mb-5 min-h-11 rounded-xl border border-hairline bg-panel px-4 py-3 text-[15px] text-ink" />
    <Text className="mb-2 text-[14px] text-ink">Device name</Text>
    <TextInput value={name} onChangeText={setName} editable={!busy && !grant} maxLength={128} accessibilityLabel="Device name"
      className="mb-5 min-h-11 rounded-xl border border-hairline bg-panel px-4 py-3 text-[15px] text-ink" />
    {grant ? <View className="mb-5 gap-3 rounded-2xl border border-hairline bg-panel p-5">
      <Text className="text-[14px] text-ink-secondary">Confirm this code in Zakura</Text>
      <Text selectable className="text-[28px] font-semibold text-ink">{grant.data.user_code}</Text>
      <Text accessibilityLiveRegion="polite" className="text-[14px] text-ink-secondary">Waiting for authorization… Return here after choosing your bots.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Open Zakura authorization" className="min-h-11 justify-center rounded-xl bg-accent px-4"
        onPress={() => { void WebBrowser.openBrowserAsync(grant.data.verification_uri_complete); }}>
        <Text className="text-center font-semibold text-app">Open Zakura authorization</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel login" className="min-h-11 justify-center" onPress={() => { setGrant(null); setError(null); }}>
        <Text className="text-center text-ink-secondary">Cancel login</Text>
      </Pressable>
    </View> : <Pressable onPress={() => void begin()} disabled={busy} accessibilityRole="button" accessibilityLabel="Sign in with Zakura"
      className="min-h-12 flex-row items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3">
      {busy ? <ActivityIndicator color="#070707" /> : null}<Text className="font-semibold text-app">{busy ? "Connecting…" : "Sign in with Zakura"}</Text>
    </Pressable>}
    {error || authNotice ? <Text accessibilityRole="alert" className="my-4 text-[14px] leading-6 text-danger">{error ?? authNotice}</Text> : null}
    {profiles.length ? <View className="mt-6 gap-2">
      <Text className="text-[14px] font-semibold text-ink">Saved instances</Text>
      {profiles.map((profile) => <Pressable key={profile.id} onPress={() => void choose(profile.id)} accessibilityRole="button"
        accessibilityLabel={`Switch to ${profile.label}`} className="min-h-12 rounded-xl border border-hairline bg-panel p-3">
        <Text className="text-ink">{profile.label}</Text><Text className="mt-1 text-[12px] text-ink-secondary">{profile.baseUrl}</Text>
      </Pressable>)}
    </View> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Try demo" className="mt-6 min-h-11 items-center justify-center"
      onPress={() => { void updateSettings({ useMockChannel: true, onboardingComplete: true }).then(() => router.replace("/")).catch((cause: Error) => setError(cause.message)); }}>
      <Text className="text-[14px] text-ink-secondary">Try demo</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Advanced connection settings" className="min-h-11 items-center justify-center" onPress={() => router.push("/settings")}>
      <Text className="text-[13px] text-ink-secondary">Advanced · manual device token</Text>
    </Pressable>
  </ScrollView>;
}
