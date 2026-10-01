import { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { exchangeOAuthCode, validatePendingState } from "@/lib/auth";
import { takePendingLogin } from "@/lib/oauth-web";
import { useStore } from "@/lib/store";

/** OAuth 重定向落点（web）。弹窗模式把授权码发回 opener；同标签页模式自行完成登录。 */
export default function OAuthCallback() {
  const { completeSignIn, reportAuthError } = useStore();
  const router = useRouter();
  const [message, setMessage] = useState("正在完成 Zakura 登录…");
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const fail = (text: string) => {
      setMessage(text);
      reportAuthError(text);
      router.replace("/");
    };
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ source: "zakura-bot-oauth", code, state, error: oauthError }, window.location.origin);
      setMessage(oauthError ? "授权失败，此窗口会自动关闭。" : "已收到授权，此窗口会自动关闭。");
      const timer = setTimeout(() => window.close(), 600);
      return () => clearTimeout(timer);
    }
    if (oauthError) {
      fail(oauthError === "access_denied" ? "Authorization was declined. You can start again." : `Zakura authorization failed: ${oauthError}.`);
      return;
    }
    const pending = takePendingLogin();
    if (!code || !pending) {
      fail("The sign-in callback was missing an authorization code. Start again.");
      return;
    }
    // Same-tab callbacks must prove the URL state matches this window's pending login before exchanging.
    const stateProblem = validatePendingState(state, pending.state);
    if (stateProblem) { fail(stateProblem); return; }
    void (async () => {
      try {
        const tokens = await exchangeOAuthCode(pending.baseUrl,
          { code, verifier: pending.verifier, clientId: pending.clientId, redirectUri: pending.redirectUri });
        await completeSignIn(pending.baseUrl, pending.clientId, tokens);
        router.replace("/");
      } catch (cause) {
        fail(cause instanceof Error ? cause.message : "Could not complete the Zakura login. Please try again.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <View className="flex-1 items-center justify-center bg-app p-6">
    <Text className="text-[17px] text-ink">{message}</Text>
  </View>;
}
