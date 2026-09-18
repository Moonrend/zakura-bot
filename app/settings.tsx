import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { Check, ChevronRight, Plus } from "lucide-react-native";
import { useRouter } from "expo-router";
import Head from "expo-router/head";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "@/lib/store";
import { validateLiveSettings } from "@/lib/channel";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { useScreenFocus } from "@/lib/use-screen-focus";
import { useFocusOnRemoval } from "@/lib/use-focus-on-removal";
import { cn } from "@/lib/cn";

const ICON = "#8a8a8a";

// Grok Bot settings: sparse cards of rows, no explanatory prose.
function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <View className={cn("mb-4 overflow-hidden rounded-3xl bg-panel", className)}>{children}</View>;
}
function Row({ children, first, className }: { children: ReactNode; first?: boolean; className?: string }) {
  return <View className={cn("mx-4 min-h-14 flex-row items-center justify-between gap-4 py-3", !first && "border-t border-hairline", className)}>{children}</View>;
}

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
  const version = Constants.expoConfig?.version ?? "";
  const input = "min-w-0 flex-1 py-2 text-right text-[16px] text-ink";

  return (
    <ScrollView ref={screenRef} className="flex-1 bg-app" keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 24), width: "100%", maxWidth: 680, alignSelf: "center" }}>
      <Head><title>Settings · Zakura Bot</title></Head>
      <Text ref={headingRef} {...(Platform.OS === "web" ? { tabIndex: -1 } : {})}
        className="mb-2 px-4 pt-2 text-[13px] text-ink-secondary" accessibilityRole="header">Your connection</Text>
      <Card>
        <Row first>
          <Text className="text-[17px] text-ink">Demo mode</Text>
          <Switch value={useMock} onValueChange={(value) => { edit(); setUseMock(value); }}
            disabled={!settingsReady || saving} accessibilityLabel="Use mock channel"
            trackColor={{ false: "#444", true: "#fcfcfc" }} thumbColor={useMock ? "#070707" : "#fcfcfc"} />
        </Row>
      </Card>

      <Card>
        {profiles.map((profile, index) => {
          const active = settings.profileId === profile.id && !settings.useMockChannel;
          return <Pressable key={profile.id} accessibilityRole="button" accessibilityLabel={`Switch to ${profile.label}`}
            onPress={() => { void switchInstance(profile.id).then(() => { setDirty(false); setError(null); }).catch((cause: Error) => setError(cause.message)); }}
            className="active:bg-raised/40">
            <Row first={index === 0}>
              <View className="min-w-0 flex-1">
                <Text className="text-[17px] text-ink" numberOfLines={1}>{profile.label}</Text>
                <Text className="mt-0.5 text-[13px] text-ink-secondary" numberOfLines={1}>{profile.baseUrl}</Text>
              </View>
              {active ? <Check size={18} color="#fcfcfc" /> : <ChevronRight size={18} color={ICON} />}
            </Row>
          </Pressable>;
        })}
        <Pressable accessibilityRole="button" accessibilityLabel="Add instance" onPress={() => router.push("/login")} className="active:bg-raised/40">
          <Row first={profiles.length === 0}>
            <Text className="text-[17px] text-ink">Add instance</Text>
            <Plus size={18} color={ICON} />
          </Row>
        </Pressable>
      </Card>

      <Card>
        <Row first>
          <Text className="text-[17px] text-ink">Base URL</Text>
          <TextInput value={baseUrl} onChangeText={(value) => { edit(); setBaseUrl(value); }}
            editable={settingsReady && !saving} autoCapitalize="none" autoCorrect={false} keyboardType="url"
            accessibilityLabel="Zakura Base URL" placeholder="https://zakura.example.com" placeholderTextColor="#8a8a8a" className={input} />
        </Row>
        <Row>
          <Text className="text-[17px] text-ink">Token</Text>
          <TextInput value={token} onChangeText={(value) => { edit(); setToken(value); }}
            editable={settingsReady && !saving} autoCapitalize="none" autoCorrect={false} autoComplete="off" secureTextEntry
            accessibilityLabel="Auth token" placeholder="Device token" placeholderTextColor="#8a8a8a" className={input} />
        </Row>
      </Card>

      {settings.onboardingComplete ? <Card>
        <Pressable accessibilityRole="button" accessibilityLabel="Sign out" disabled={saving} className="active:bg-raised/40"
          onPress={() => { setSaving(true); void signOut().then(() => router.dismissTo("/")).catch((cause: Error) => setError(cause.message)).finally(() => setSaving(false)); }}>
          <Row first><Text className="text-[17px] text-danger">Sign out</Text></Row>
        </Pressable>
      </Card> : null}

      {error || authNotice ? <View className="mb-4 px-4" accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Text className="text-[13px] leading-5 text-danger">{error ?? authNotice}</Text>
      </View> : null}
      <View ref={actionsRef} tabIndex={Platform.OS === "web" ? -1 : undefined}
        role={Platform.OS === "web" ? "group" : undefined} accessibilityLabel="Settings actions">
        <Pressable ref={saveRef} onPress={() => void onSave()} disabled={!settingsReady || saving}
          accessibilityRole="button" accessibilityLabel="Save settings" aria-busy={saving} accessibilityState={{ disabled: !settingsReady || saving, busy: saving }}
          className="min-h-12 flex-row items-center justify-center gap-2 rounded-full bg-ink py-3 active:opacity-80">
          {saving ? <ActivityIndicator size="small" color="#070707" /> : saved ? <Check size={18} color="#070707" /> : null}
          <Text className="text-[16px] font-semibold text-app">{saving ? "Saving…" : saved ? "Saved" : "Save"}</Text>
        </Pressable>
        <Text accessibilityLiveRegion="polite" className="mt-2 text-center text-[12px] text-ink-secondary">{saved ? "Settings saved on this device." : " "}</Text>
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close settings"
          className="mt-1 min-h-11 items-center justify-center rounded-full py-3 active:bg-panel">
          <Text className="text-[15px] text-ink-secondary">Close</Text>
        </Pressable>
      </View>

      <View className="mt-10 items-center gap-2">
        <View className="h-14 w-14 rounded-full bg-ink" />
        <Text className="mt-2 text-[20px] font-medium text-ink">Zakura Bot</Text>
        {version ? <Text className="text-[13px] text-ink-secondary">{version}</Text> : null}
      </View>
    </ScrollView>
  );
}
