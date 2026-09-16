import "../global.css";
import { Stack } from "expo-router";
import Head from "expo-router/head";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { StoreProvider } from "@/lib/store";

export default function RootLayout() {
  return (
    <StoreProvider>
      <Head><title>Zakura Bot</title></Head>
      <View className="flex-1 bg-app">
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
