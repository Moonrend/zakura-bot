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
      // Never treat missing mock flag as live
      useMockChannel: parsed.useMockChannel ?? true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}
