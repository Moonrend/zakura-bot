import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Check, Save } from "lucide-react-native";
import { useRouter } from "expo-router";
import Head from "expo-router/head";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "@/lib/store";
import { validateLiveSettings } from "@/lib/channel";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { useScreenFocus } from "@/lib/use-screen-focus";
import { useFocusOnRemoval } from "@/lib/use-focus-on-removal";
import { Field } from "@/components/ui/Field";

export default function SettingsScreen() {
  const { settings, settingsReady, updateSettings, profiles, switchInstance, signOut, authNotice } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [baseUrl, setBaseUrl] = useState(settings.zakuraBaseUrl);
  const [token, setToken] = useState(settings.authToken);
  const [useMock, setUseMock] = useState(settings.useMockChannel);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const screenRef = useRef<ScrollView>(null);
  const headingRef = useRef<Text>(null);
  const headingFocusTarget = useCallback(() => headingRef.current as unknown as HTMLElement | null, []);
  useScreenFocus(screenRef, headingFocusTarget);
  const actionsRef = useRef<View>(null);
  const focusActions = useCallback(() => {
    if (Platform.OS === "web") (actionsRef.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
  }, []);
  const saveRef = useFocusOnRemoval(focusActions);

  useEffect(() => {
    if (!settingsReady || dirty) return;
    setBaseUrl(settings.zakuraBaseUrl);
    setToken(settings.authToken);
    setUseMock(settings.useMockChannel);
  }, [settings, settingsReady, dirty]);

  const edit = () => { setDirty(true); setSaved(false); setError(null); };
  const onSave = async () => {
    if (saving || !settingsReady) return;
    const next = { zakuraBaseUrl: baseUrl.trim() || (useMock ? DEFAULT_SETTINGS.zakuraBaseUrl : ""), authToken: token.trim(), useMockChannel: useMock };
    const problem = useMock ? null : validateLiveSettings({ baseUrl: next.zakuraBaseUrl, token: next.authToken });
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError(null);
    try {
      await updateSettings(next);
      setSaved(true);
      setDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  };
  const close = () => router.canGoBack() ? router.back() : router.replace("/");

  return (
    <ScrollView ref={screenRef} className="flex-1 bg-app" keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, paddingBottom: Math.max(insets.bottom, 20), width: "100%", maxWidth: 680, alignSelf: "center" }}>
      <Head><title>Settings · Zakura Bot</title></Head>
      <Text ref={headingRef} {...(Platform.OS === "web" ? { tabIndex: -1 } : {})}
        className="mb-5 text-[20px] font-semibold text-ink" accessibilityRole="header">Settings</Text>
      <View className="mb-6 gap-3">
        <Pressable accessibilityRole="button" accessibilityLabel="Add instance" onPress={() => router.push("/login")}
          className="min-h-11 items-center justify-center rounded-xl bg-accent p-3"><Text className="font-semibold text-app">Sign in</Text></Pressable>
        {profiles.map((profile) => <Pressable key={profile.id} accessibilityRole="button" accessibilityLabel={`Switch to ${profile.label}`}
          onPress={() => { void switchInstance(profile.id).then(() => { setDirty(false); setError(null); }).catch((cause: Error) => setError(cause.message)); }}
          className="rounded-xl border border-hairline bg-panel p-3">
          <Text className="text-ink">{profile.label}{settings.profileId === profile.id && !settings.useMockChannel ? " · Active" : ""}</Text>
          <Text className="mt-1 text-[12px] text-ink-secondary">{profile.baseUrl}</Text>
        </Pressable>)}
        {settings.onboardingComplete ? <Pressable accessibilityRole="button" accessibilityLabel="Sign out" disabled={saving}
          onPress={() => { setSaving(true); void signOut().then(() => router.dismissTo("/")).catch((cause: Error) => setError(cause.message)).finally(() => setSaving(false)); }}
          className="min-h-11 items-center justify-center rounded-xl border border-hairline p-3"><Text className="text-danger">Sign out</Text></Pressable> : null}
        {authNotice ? <Text className="text-danger">{authNotice}</Text> : null}
      </View>
      <View className="mb-6 flex-row items-center justify-between py-2">
        <View className="mr-4 min-w-0 flex-1">
          <Text className="text-[15px] text-ink">Mock channel</Text>
        </View>
        <Switch value={useMock} onValueChange={(value) => { edit(); setUseMock(value); }}
          disabled={!settingsReady || saving} accessibilityLabel="Use mock channel"
          trackColor={{ false: "#444", true: "#1084fe" }} />
      </View>
      <Field label="Base URL" value={baseUrl} onChangeText={(value) => { edit(); setBaseUrl(value); }}
        editable={settingsReady && !saving} autoCapitalize="none" autoCorrect={false} keyboardType="url"
        accessibilityLabel="Zakura Base URL" placeholder="https://zakura.example.com" containerClassName="mb-4" />
      <Field label="Auth token" value={token} onChangeText={(value) => { edit(); setToken(value); }}
        editable={settingsReady && !saving} autoCapitalize="none" autoCorrect={false} autoComplete="off" secureTextEntry
        accessibilityLabel="Auth token" placeholder="Zakura Bot device token" containerClassName="mb-5" />
      {error ? <Text className="mb-4 text-[13px] leading-5 text-danger" accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text> : null}
      <View ref={actionsRef} tabIndex={Platform.OS === "web" ? -1 : undefined}
        role={Platform.OS === "web" ? "group" : undefined} accessibilityLabel="Settings actions">
        <Pressable ref={saveRef} onPress={() => void onSave()} disabled={!settingsReady || saving}
          accessibilityRole="button" accessibilityLabel="Save settings" aria-busy={saving} accessibilityState={{ disabled: !settingsReady || saving, busy: saving }}
          className="min-h-11 flex-row items-center justify-center gap-2 rounded-xl bg-accent py-3.5 active:opacity-80">
          {saving ? <ActivityIndicator size="small" color="#070707" /> : saved ? <Check size={18} color="#070707" /> : <Save size={17} color="#070707" />}
          <Text className="text-[15px] font-semibold text-app">{saving ? "Saving…" : saved ? "Saved" : "Save"}</Text>
        </Pressable>
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close settings"
          className="mt-2 min-h-11 items-center justify-center rounded-xl py-3 active:bg-panel">
          <Text className="text-[14px] text-ink-secondary">Close</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
