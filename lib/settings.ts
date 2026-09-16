import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_SETTINGS, type AppSettings } from "./types";

const KEY = "zakura-bot.settings.v1";

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ...DEFAULT_SETTINGS };
    const value = parsed as Record<string, unknown>;
    return {
      zakuraBaseUrl:
        typeof value.zakuraBaseUrl === "string" && value.zakuraBaseUrl.trim()
          ? value.zakuraBaseUrl.trim()
          : DEFAULT_SETTINGS.zakuraBaseUrl,
      authToken: typeof value.authToken === "string" ? value.authToken.trim() : "",
      // Never treat a missing mock flag as live
      useMockChannel: typeof value.useMockChannel === "boolean" ? value.useMockChannel : true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  // Propagate failures so Settings never reports a save that did not persist.
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}
