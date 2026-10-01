import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Appearance, Platform } from "react-native";
import { DEFAULT_SETTINGS, type AppSettings, type ThemePreference } from "./types";
import type { Credentials, InstanceProfile } from "./auth";

const KEY = "zakura-bot.settings.v1";
const PROFILES_KEY = "zakura-bot.instances.v1";
const credentialKey = (id: string) => `zakura-bot.credentials.${id}`;

export function applyTheme(theme: ThemePreference | undefined): void {
  if (typeof Appearance.setColorScheme !== "function") return;
  Appearance.setColorScheme(theme === "light" || theme === "dark" ? theme : "unspecified");
}

export async function readCredentials(id: string): Promise<Credentials | null> {
  const key = credentialKey(id);
  const raw = Platform.OS === "web" ? sessionStorage.getItem(key) : await SecureStore.getItemAsync(key);
  return raw ? JSON.parse(raw) as Credentials : null;
}
export async function writeCredentials(id: string, credentials: Credentials): Promise<void> {
  const key = credentialKey(id), raw = JSON.stringify(credentials);
  if (Platform.OS === "web") sessionStorage.setItem(key, raw);
  else await SecureStore.setItemAsync(key, raw, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}
export async function loadProfiles(): Promise<InstanceProfile[]> {
  const raw = await AsyncStorage.getItem(PROFILES_KEY);
  const value: unknown = raw ? JSON.parse(raw) : [];
  return Array.isArray(value) ? value.filter((row): row is InstanceProfile => row && typeof row.id === "string" &&
    /^[a-zA-Z0-9._-]+$/.test(row.id) && typeof row.baseUrl === "string" && typeof row.label === "string") : [];
}
export async function saveProfile(profile: InstanceProfile, credentials: Credentials): Promise<void> {
  await writeCredentials(profile.id, credentials);
  const profiles = await loadProfiles();
  await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify([...profiles.filter((item) => item.id !== profile.id), profile]));
}
export async function removeProfile(id: string): Promise<void> {
  if (Platform.OS === "web") sessionStorage.removeItem(credentialKey(id));
  else await SecureStore.deleteItemAsync(credentialKey(id));
  await AsyncStorage.setItem(PROFILES_KEY, JSON.stringify((await loadProfiles()).filter((item) => item.id !== id)));
}

export async function loadSettings(): Promise<AppSettings> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) {
    const defaults = { ...DEFAULT_SETTINGS };
    applyTheme(defaults.theme);
    return defaults;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const defaults = { ...DEFAULT_SETTINGS };
    applyTheme(defaults.theme);
    return defaults;
  }
  const value = parsed as Partial<AppSettings>;
  const settings: AppSettings = { zakuraBaseUrl: typeof value.zakuraBaseUrl === "string" ? value.zakuraBaseUrl : DEFAULT_SETTINGS.zakuraBaseUrl,
    authToken: "", useMockChannel: value.useMockChannel !== false, profileId: value.profileId,
    onboardingComplete: value.onboardingComplete ?? true,
    spaceId: typeof value.spaceId === "string" ? value.spaceId : undefined,
    spaceName: typeof value.spaceName === "string" ? value.spaceName : undefined,
    theme: value.theme === "light" || value.theme === "dark" || value.theme === "system" ? value.theme : DEFAULT_SETTINGS.theme };
  // Migrate old plaintext tokens once, then erase them from ordinary preferences.
  if (typeof value.authToken === "string" && value.authToken.trim()) {
    settings.authToken = value.authToken.trim();
    settings.profileId ??= `manual-${Date.now().toString(36)}`;
    await saveSettings(settings);
  } else if (settings.profileId) {
    settings.authToken = (await readCredentials(settings.profileId))?.accessToken ?? "";
    if (!settings.authToken && !settings.useMockChannel) settings.onboardingComplete = false;
  }
  applyTheme(settings.theme);
  return settings;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  if (settings.authToken) {
    settings.profileId ??= `manual-${Date.now().toString(36)}`;
    const existing = await readCredentials(settings.profileId);
    const profile = (await loadProfiles()).find((item) => item.id === settings.profileId);
    await saveProfile(profile ?? { id: settings.profileId, baseUrl: settings.zakuraBaseUrl, label: settings.zakuraBaseUrl },
      existing?.accessToken === settings.authToken ? existing : { accessToken: settings.authToken });
  }
  const { authToken: _secret, ...preferences } = settings;
  await AsyncStorage.setItem(KEY, JSON.stringify(preferences));
}
