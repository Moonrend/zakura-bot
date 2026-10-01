import AsyncStorage from "@react-native-async-storage/async-storage";
const key = (scope: string) => `zakura-bot.space.v1.${encodeURIComponent(scope)}`;
export async function loadSpaceId(scope: string): Promise<string | null> {
  const raw = await AsyncStorage.getItem(key(scope));
  return raw && raw.trim() ? raw : null;
}
export const saveSpaceId = (scope: string, spaceId: string | null) =>
  spaceId ? AsyncStorage.setItem(key(scope), spaceId) : AsyncStorage.removeItem(key(scope));
