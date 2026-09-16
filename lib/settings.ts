import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_SETTINGS, type AppSettings } from "./types";

const KEY = "zakura-bot.settings.v1";

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      zakuraBaseUrl:
        typeof parsed.zakuraBaseUrl === "string" && parsed.zakuraBaseUrl.trim()
          ? parsed.zakuraBaseUrl.trim()
          : DEFAULT_SETTINGS.zakuraBaseUrl,
      authToken: typeof parsed.authToken === "string" ? parsed.authToken : "",
      // Never treat a missing mock flag as live
      useMockChannel: parsed.useMockChannel ?? true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn("[zakura-bot] failed to persist settings", err);
  }
}
