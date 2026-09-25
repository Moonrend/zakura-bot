import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { instanceUrl, registerOAuthClient } from "./auth";

export type PendingLogin = { baseUrl: string; clientId: string; verifier: string; state: string; redirectUri: string };

const PENDING_KEY = "zakura-bot.oauth-pending";
const clientKey = (base: string) => `zakura-bot.oauth-client.${base}`;

export function oauthRedirectUri(baseUrl: string): string {
  if (Platform.OS !== "web") return "zakurabot://oauth";
  void baseUrl;
  return `${window.location.origin}/oauth/callback`;
}

/** 每实例缓存一个动态注册的公共客户端；来源变化（web 部署地址变化）时重新注册。 */
export async function ensureOAuthClient(baseUrl: string): Promise<string> {
  const base = instanceUrl(baseUrl);
  const key = clientKey(base);
  const cached = await AsyncStorage.getItem(key);
  if (cached) {
    const parsed = JSON.parse(cached) as { clientId: string; origin: string };
    const currentOrigin = Platform.OS === "web" ? window.location.origin : "zakurabot:";
    if (parsed.origin === currentOrigin) return parsed.clientId;
  }
  const { client_id } = await registerOAuthClient(base, oauthRedirectUri(base));
  await AsyncStorage.setItem(key, JSON.stringify({ clientId: client_id, origin: Platform.OS === "web" ? window.location.origin : "zakurabot:" }));
  return client_id;
}

export function savePendingLogin(pending: PendingLogin): void {
  if (Platform.OS !== "web") return;
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

export function takePendingLogin(): PendingLogin | null {
  if (Platform.OS !== "web") return null;
  const raw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  return raw ? JSON.parse(raw) as PendingLogin : null;
}
