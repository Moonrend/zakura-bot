import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { codeFromRedirect, exchangeOAuthCode, instanceUrl, startOAuthLogin } from "@/lib/auth";
import { ensureOAuthClient, oauthRedirectUri, savePendingLogin, takePendingLogin } from "@/lib/oauth-web";
import { useStore } from "@/lib/store";

export function SignIn() {
  const { settings, completeSignIn, switchInstance, profiles, authNotice, updateSettings } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState(settings.zakuraBaseUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startRef = useRef<{ baseUrl: string; verifier: string; state: string } | null>(null);

  async function settle(baseUrl: string, verifier: string, code: string, state: string, clientId: string, redirectUri: string) {
    if (startRef.current?.state && state && startRef.current.state !== state) throw new Error("Zakura returned a mismatched login state.");
    const tokens = await exchangeOAuthCode(baseUrl, { code, verifier, clientId, redirectUri });
    await completeSignIn(baseUrl, clientId, tokens);
    if (!Platform.OS || Platform.OS !== "web" || !window.opener) router.dismissTo("/");
  }

  // Web 弹窗回调：/oauth/callback 页面把授权码发回本页。
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; code?: string; state?: string } | null;
      if (event.origin !== window.location.origin || data?.source !== "zakura-bot-oauth" || !data.code) return;
      const pending = takePendingLogin();
      if (!pending || !startRef.current) return;
      setBusy(true); setError(null);
      settle(pending.baseUrl, startRef.current.verifier, data.code, data.state ?? startRef.current.state,
        pending.clientId, pending.redirectUri)
        .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not complete the Zakura login."))
        .finally(() => setBusy(false));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function begin() {
    if (busy) return;
    try {
      const baseUrl = instanceUrl(url);
      setBusy(true); setError(null);
      const clientId = await ensureOAuthClient(baseUrl);
      const redirectUri = oauthRedirectUri(baseUrl);
      const start = await startOAuthLogin(baseUrl, clientId, redirectUri);
      startRef.current = { baseUrl, verifier: start.verifier, state: start.state };
      if (Platform.OS === "web") {
        savePendingLogin({ baseUrl, clientId, verifier: start.verifier, state: start.state, redirectUri });
        const popup = window.open(start.authorizationUrl, "_blank", "popup");
        if (!popup) window.location.href = start.authorizationUrl;
      } else {
        const result = await WebBrowser.openAuthSessionAsync(start.authorizationUrl, start.redirectUri);
        if (result.type !== "success") throw new Error("Authorization was cancelled. You can start again.");
        const code = codeFromRedirect(result.url, start.state);
        await settle(baseUrl, start.verifier, code, start.state, clientId, start.redirectUri);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start Zakura login.");
    } finally { setBusy(false); }
  }
  async function choose(id: string) {
    try { await switchInstance(id); router.dismissTo("/"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Sign in again."); }
  }
  return <ScrollView className="flex-1 bg-app" keyboardShouldPersistTaps="handled"
    contentContainerStyle={{ padding: 24, paddingTop: Math.max(insets.top, 48), paddingBottom: Math.max(insets.bottom, 24), maxWidth: 560, width: "100%", alignSelf: "center" }}>
    <View className="mb-8 items-center"><View className="h-16 w-16 rounded-full bg-ink" /></View>
    <Text className="mb-2 text-center text-[24px] font-medium text-ink" accessibilityRole="header">Connect to Zakura</Text>
    <Text className="mb-6 text-center text-[13px] leading-5 text-ink-secondary">Sign in with your Zakura account. Zakura Bot uses your own permissions: every agent you can reach, with no extra setup.</Text>
    <View className="mb-5 overflow-hidden rounded-3xl bg-panel">
      <View className="mx-4 min-h-14 flex-row items-center gap-4 py-2">
        <Text className="text-[16px] text-ink">Instance</Text>
        <TextInput value={url} onChangeText={setUrl} editable={!busy} accessibilityLabel="Zakura instance URL"
          autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://zakura.example.com" placeholderTextColor="#8a8a8a"
          className="min-h-11 min-w-0 flex-1 text-right text-[16px] text-ink" />
      </View>
    </View>
    <Pressable onPress={() => void begin()} disabled={busy} accessibilityRole="button" accessibilityLabel="Sign in with Zakura"
      className="min-h-12 flex-row items-center justify-center gap-2 rounded-full bg-ink px-4 py-3">
      {busy ? <ActivityIndicator color="#070707" /> : null}<Text className="font-semibold text-app">{busy ? "Connecting…" : "Sign in with Zakura"}</Text>
    </Pressable>
    {error || authNotice ? <Text accessibilityRole="alert" className="my-4 text-[14px] leading-6 text-danger">{error ?? authNotice}</Text> : null}
    {profiles.length ? <View className="mt-6 overflow-hidden rounded-3xl bg-panel">
      {profiles.map((profile, index) => <Pressable key={profile.id} onPress={() => void choose(profile.id)} accessibilityRole="button"
        accessibilityLabel={`Switch to ${profile.label}`} className="active:bg-raised/40">
        <View className={`mx-4 min-h-14 justify-center py-3 ${index > 0 ? "border-t border-hairline" : ""}`}>
          <Text className="text-[16px] text-ink" numberOfLines={1}>{profile.label}</Text><Text className="mt-0.5 text-[13px] text-ink-secondary" numberOfLines={1}>{profile.baseUrl}</Text>
        </View>
      </Pressable>)}
    </View> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Try demo" className="mt-6 min-h-11 items-center justify-center"
      onPress={() => { void updateSettings({ useMockChannel: true, onboardingComplete: true }).then(() => router.dismissTo("/")).catch((cause: Error) => setError(cause.message)); }}>
      <Text className="text-[14px] text-ink-secondary">Try demo</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Advanced connection settings" className="min-h-11 items-center justify-center" onPress={() => router.push("/settings")}>
      <Text className="text-[13px] text-ink-secondary">Advanced</Text>
    </Pressable>
  </ScrollView>;
}
