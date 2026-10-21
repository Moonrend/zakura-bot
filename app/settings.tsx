import { useCallback, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Check, ChevronRight, Plus, X } from "lucide-react-native";
import { useRouter } from "expo-router";
import Head from "expo-router/head";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "@/lib/store";
import { applyTheme } from "@/lib/settings";
import type { ThemePreference } from "@/lib/types";
import { FeedbackSheet } from "@/components/FeedbackSheet";
import { PluginsModal } from "@/components/PluginsModal";
import { useScreenFocus } from "@/lib/use-screen-focus";
import { cn } from "@/lib/cn";

const ICON = "#8a8a8a";
const THEMES: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "Follow system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function Card({ children }: { children: ReactNode }) {
  return <View className="mb-4 overflow-hidden rounded-2xl bg-panel">{children}</View>;
}
function Row({ children, first }: { children: ReactNode; first?: boolean }) {
  return <View className={cn("mx-4 min-h-14 flex-row items-center justify-between gap-4 py-3", !first && "border-t border-hairline")}>{children}</View>;
}

export default function SettingsScreen() {
  const { settings, settingsReady, updateSettings, profiles, switchInstance, signOut, authNotice, spaces, switchSpace } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const screenRef = useRef<ScrollView>(null);
  const headingRef = useRef<Text>(null);
  const headingFocusTarget = useCallback(() => headingRef.current as unknown as HTMLElement | null, []);
  useScreenFocus(screenRef, headingFocusTarget);
  const close = () => router.canGoBack() ? router.back() : router.replace("/");
  const run = async (action: () => Promise<unknown>) => {
    if (pending) return;
    setPending(true); setError(null);
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save."); }
    finally { setPending(false); }
  };
  const chooseTheme = (value: ThemePreference) => {
    if (value === settings.theme || !settingsReady) return;
    void run(async () => {
      await updateSettings({ theme: value, onboardingComplete: settings.onboardingComplete });
      applyTheme(value);
    });
  };

  return <ScrollView ref={screenRef} className="flex-1 bg-app" keyboardShouldPersistTaps="handled"
    contentContainerStyle={{ padding: 16, paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 24), width: "100%", maxWidth: 600, alignSelf: "center" }}>
    <Head><title>Settings · Zakura Bot</title></Head>
    <View className="mb-5 flex-row items-center justify-between px-1">
      <Text ref={headingRef} {...(Platform.OS === "web" ? { tabIndex: -1 } : {})}
        className="text-[22px] font-semibold text-ink" accessibilityRole="header">Settings</Text>
      <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close settings"
        className="h-11 w-11 items-center justify-center rounded-full bg-raised active:bg-raised-hover"><X size={20} color={ICON} /></Pressable>
    </View>
    <Card>
      {profiles.map((profile, index) => {
        const active = settings.profileId === profile.id && !settings.useMockChannel;
        return <Pressable key={profile.id} accessibilityRole="button" accessibilityLabel={`Switch to ${profile.label}`}
          disabled={pending} onPress={() => void run(() => switchInstance(profile.id))} className="active:bg-raised/40">
          <Row first={index === 0}>
            <View className="min-w-0 flex-1">
              <Text className="text-[17px] text-ink" numberOfLines={1}>{profile.label}</Text>
              <Text className="mt-0.5 text-[13px] text-ink-secondary" numberOfLines={1}>{profile.baseUrl}</Text>
            </View>
            {active ? <Check size={18} color={ICON} /> : <ChevronRight size={18} color={ICON} />}
          </Row>
        </Pressable>;
      })}
      <Pressable accessibilityRole="button" accessibilityLabel="Add instance" onPress={() => router.push("/login")} className="active:bg-raised/40">
        <Row first={profiles.length === 0}><Text className="text-[17px] text-ink">Add account</Text><Plus size={18} color={ICON} /></Row>
      </Pressable>
    </Card>
    {spaces.length > 1 ? <Card>
      {spaces.map((space, index) => {
        const active = settings.spaceId ? settings.spaceId === space.id : space.slug === "default";
        return <Pressable key={space.id} accessibilityRole="button" accessibilityLabel={`Switch to space ${space.name}`}
          disabled={pending} onPress={() => void run(() => switchSpace(space))} className="active:bg-raised/40">
          <Row first={index === 0}><Text className="min-w-0 flex-1 text-[17px] text-ink" numberOfLines={1}>{space.name}</Text>
            {active ? <Check size={18} color={ICON} /> : <ChevronRight size={18} color={ICON} />}</Row>
        </Pressable>;
      })}
    </Card> : null}
    <Text className="mb-2 px-4 text-[13px] text-ink-secondary">Appearance</Text>
    <Card>{THEMES.map((option, index) => <Pressable key={option.value} accessibilityRole="radio"
      accessibilityLabel={`Theme: ${option.label}`} aria-checked={option.value === (settings.theme ?? "system")} accessibilityState={{ checked: option.value === (settings.theme ?? "system") }}
      disabled={!settingsReady || pending} onPress={() => chooseTheme(option.value)} className="active:bg-raised/40">
      <Row first={index === 0}><Text className="text-[17px] text-ink">{option.label}</Text>
        {option.value === (settings.theme ?? "system") ? <Check size={18} color={ICON} /> : null}</Row>
    </Pressable>)}</Card>
    <Card>
      <Pressable accessibilityRole="button" accessibilityLabel="Plugins" onPress={() => setPluginsOpen(true)} className="active:bg-raised/40">
        <Row first><Text className="text-[17px] text-ink">Plugins</Text><ChevronRight size={18} color={ICON} /></Row>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Send feedback" onPress={() => setFeedbackOpen(true)} className="active:bg-raised/40">
        <Row><Text className="text-[17px] text-ink">Send feedback</Text><ChevronRight size={18} color={ICON} /></Row>
      </Pressable>
      <Row><Text className="text-[17px] text-ink">Zakura Bot</Text><Text className="text-[15px] text-ink-secondary">{Constants.expoConfig?.version}</Text></Row>
    </Card>
    {settings.onboardingComplete ? <Card>
      <Pressable accessibilityRole="button" accessibilityLabel="Sign out" disabled={pending}
        onPress={() => setConfirmSignOut(true)} className="active:bg-raised/40">
        <Row first><Text className="text-[17px] text-danger">{settings.useMockChannel ? "Leave demo" : "Sign out"}</Text>
          {pending ? <ActivityIndicator size="small" color={ICON} /> : null}</Row>
      </Pressable>
    </Card> : null}
    {error || authNotice ? <Text accessibilityRole="alert" className="px-4 text-[13px] leading-5 text-danger">{error ?? authNotice}</Text> : null}
    <Modal visible={confirmSignOut} transparent animationType="fade" onRequestClose={() => setConfirmSignOut(false)} statusBarTranslucent>
      <View className="flex-1 items-center justify-center bg-black/60 px-6" accessibilityViewIsModal>
        <Pressable className="absolute inset-0" onPress={() => setConfirmSignOut(false)} accessible={false} focusable={false} />
        <View className="w-full max-w-sm rounded-2xl bg-panel p-5">
          <Text className="text-[17px] font-medium text-ink">Sign out?</Text>
          <View className="mt-5 flex-row items-center justify-end gap-1">
            <Pressable onPress={() => setConfirmSignOut(false)} accessibilityRole="button" accessibilityLabel="Cancel sign out" className="min-h-11 justify-center rounded-lg px-4 active:bg-raised/40"><Text className="text-[15px] text-ink-secondary">Cancel</Text></Pressable>
            <Pressable onPress={() => { setConfirmSignOut(false); void run(async () => { await signOut(); router.dismissTo("/"); }); }} accessibilityRole="button" accessibilityLabel="Confirm sign out" className="min-h-11 justify-center rounded-lg px-4 active:bg-raised/40"><Text className="text-[15px] font-semibold text-danger">Sign out</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
    <FeedbackSheet visible={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    <PluginsModal visible={pluginsOpen} onClose={() => setPluginsOpen(false)} />
  </ScrollView>;
}
