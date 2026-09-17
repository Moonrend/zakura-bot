import AsyncStorage from "@react-native-async-storage/async-storage";
import { emptyGroups, parseGroups, type BotGroups } from "./groups";
const key = (scope: string) => `zakura-bot.groups.v1.${encodeURIComponent(scope)}`;
export async function loadGroups(scope: string): Promise<BotGroups> {
  const raw = await AsyncStorage.getItem(key(scope));
  if (!raw) return emptyGroups();
  try { return parseGroups(JSON.parse(raw)); } catch { return emptyGroups(); }
}
export const saveGroups = (scope: string, groups: BotGroups) => AsyncStorage.setItem(key(scope), JSON.stringify(groups));
