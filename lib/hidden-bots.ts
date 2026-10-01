import AsyncStorage from "@react-native-async-storage/async-storage";

const key = (scope: string) => `zakura-bot.hidden-bots.v1.${encodeURIComponent(scope)}`;

export function parseHiddenBots(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id === "string" && id && !seen.has(id)) { seen.add(id); ids.push(id); }
  }
  return ids;
}

export async function loadHiddenBots(scope: string): Promise<string[]> {
  const raw = await AsyncStorage.getItem(key(scope));
  if (!raw) return [];
  try { return parseHiddenBots(JSON.parse(raw)); } catch { return []; }
}

export const saveHiddenBots = (scope: string, ids: string[]) => AsyncStorage.setItem(key(scope), JSON.stringify(ids));
