import "../global.css";
import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import Head from "expo-router/head";
import { StatusBar } from "expo-status-bar";
import { Platform, View, useWindowDimensions } from "react-native";
import { StoreProvider } from "@/lib/store";
import { useFileDropGuard } from "@/lib/use-file-drop-guard";

export default function RootLayout() {
  useFileDropGuard();
  const { height } = useWindowDimensions();
  const [webViewportHeight, setWebViewportHeight] = useState<number>();
  useEffect(() => {
    // Mobile keyboards can shrink visualViewport without changing the page's
    // percentage height. RN Web dimensions account for that and for pinch zoom.
    // Apply the constraint after hydration, when browser dimensions are known.
    if (Platform.OS === "web" && height > 0) setWebViewportHeight(height);
  }, [height]);
  return (
    <StoreProvider>
      <Head><title>Zakura Bot</title></Head>
      <View className="flex-1 bg-app" style={{ maxHeight: webViewportHeight }}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#070707" },
            animation: "fade",
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen
            name="settings"
            options={{
              presentation: "modal",
              headerShown: true,
              headerTitle: "Settings",
              headerStyle: { backgroundColor: "#111111" },
              headerTintColor: "#fcfcfc",
              headerShadowVisible: false,
            }}
          />
        </Stack>
      </View>
    </StoreProvider>
  );
}
