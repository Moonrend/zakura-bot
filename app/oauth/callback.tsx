import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { exchangeOAuthCode } from "@/lib/auth";
import { takePendingLogin } from "@/lib/oauth-web";
import { useStore } from "@/lib/store";

/** OAuth 重定向落点（web）。弹窗模式把授权码发回 opener；同标签页模式自行完成登录。 */
export default function OAuthCallback() {
  const { completeSignIn } = useStore();
  const router = useRouter();
  const [message, setMessage] = useState("正在完成 Zakura 登录…");
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ source: "zakura-bot-oauth", code, state }, window.location.origin);
      setMessage("已收到授权，此窗口会自动关闭。");
      const timer = setTimeout(() => window.close(), 600);
      return () => clearTimeout(timer);
    }
    const pending = takePendingLogin();
    if (!code || !pending) {
      setMessage("缺少授权信息，请回到 App 重新开始登录。");
      return;
    }
    void (async () => {
      try {
        const tokens = await exchangeOAuthCode(pending.baseUrl,
          { code, verifier: pending.verifier, clientId: pending.clientId, redirectUri: pending.redirectUri });
        await completeSignIn(pending.baseUrl, pending.clientId, tokens);
        router.replace("/");
      } catch (cause) {
        setMessage(cause instanceof Error ? cause.message : "登录失败，请重试。");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <View className="flex-1 items-center justify-center bg-app p-6">
    <Text className="text-[17px] text-ink">{message}</Text>
  </View>;
}
