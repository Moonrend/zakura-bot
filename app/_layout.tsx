import "../global.css";
import { useEffect, useMemo, useState } from "react";
import { Stack } from "expo-router";
import Head from "expo-router/head";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { Platform, useColorScheme, View, useWindowDimensions } from "react-native";
import { vars } from "nativewind";
import { StoreProvider, useStore } from "@/lib/store";
import { resolveTheme, themeColors, themeVariables } from "@/lib/theme";
import { useFileDropGuard } from "@/lib/use-file-drop-guard";

// Native splash stays up until hideAsync (expo-splash-screen plugin).
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  useFileDropGuard();
  const { height } = useWindowDimensions();
  const [webViewportHeight, setWebViewportHeight] = useState<number>();
  useEffect(() => {
    // Do not wait on settings/fonts — otherwise Android stays on the launch screen.
    void SplashScreen.hideAsync().catch(() => {});
  }, []);
  useEffect(() => {
    // Mobile keyboards can shrink visualViewport without changing the page's
    // percentage height. RN Web dimensions account for that and for pinch zoom.
    // Apply the constraint after hydration, when browser dimensions are known.
    if (Platform.OS === "web" && height > 0) setWebViewportHeight(height);
  }, [height]);
  return (
    <StoreProvider>
      <Head><title>Zakura Bot</title></Head>
      <ThemedRoot webViewportHeight={webViewportHeight} />
    </StoreProvider>
  );
}

function ThemedRoot({ webViewportHeight }: { webViewportHeight?: number }) {
  const { settings } = useStore();
  const systemScheme = useColorScheme();
  const scheme = resolveTheme(settings.theme, systemScheme);
  const themeStyle = useMemo(() => vars(themeVariables(scheme)), [scheme]);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const root = document.documentElement;
    for (const [name, value] of Object.entries(themeVariables(scheme))) {
      root.style.setProperty(name, value);
    }
    document.body.style.backgroundColor = themeColors(scheme).app;
  }, [scheme]);
  return (
    <View className="flex-1 bg-app" style={[themeStyle, { maxHeight: webViewportHeight }]}>
      <StatusBar style={scheme === "light" ? "dark" : "light"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: themeColors(scheme).app },
          animation: "fade",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="bots" />
        <Stack.Screen name="bots/new" />
        <Stack.Screen name="org-chart" />
        <Stack.Screen name="groups" />
        <Stack.Screen name="desktop" />
        <Stack.Screen name="agent-info" />
        <Stack.Screen
          name="settings"
          options={{
            presentation: "modal",
            headerShown: false,
          }}
        />
      </Stack>
    </View>
  );
}
