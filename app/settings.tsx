import { useState } from "react";
import {
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useStore } from "@/lib/store";

export default function SettingsScreen() {
  const { settings, updateSettings, connection } = useStore();
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(settings.zakuraBaseUrl);
  const [token, setToken] = useState(settings.authToken);
  const [useMock, setUseMock] = useState(settings.useMockChannel);
  const [saved, setSaved] = useState(false);

  const onSave = async () => {
    await updateSettings({
      zakuraBaseUrl: baseUrl.trim() || "http://127.0.0.1:8787",
      authToken: token,
      useMockChannel: useMock,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const inputStyle =
    Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : undefined;

  return (
    <ScrollView className="flex-1 bg-app" contentContainerStyle={{ padding: 20 }}>
      <Text className="mb-1 text-[13px] uppercase tracking-wide text-ink-secondary">
        Zakura connection
      </Text>
      <Text className="mb-4 text-[13px] text-ink-secondary">
        Phase 1 stores these locally for the future live channel. The app currently
        uses MockZakuraChannelClient ({connection}).
      </Text>

      <Text className="mb-1.5 text-[13px] text-ink">Base URL</Text>
      <TextInput
        value={baseUrl}
        onChangeText={setBaseUrl}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="http://127.0.0.1:8787"
        placeholderTextColor="#fcfcfc66"
        className="mb-4 rounded-xl border border-hairline bg-panel px-4 py-3 text-[15px] text-ink"
        style={inputStyle}
      />

      <Text className="mb-1.5 text-[13px] text-ink">Auth token</Text>
      <TextInput
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        placeholder="Device / API token (not committed)"
        placeholderTextColor="#fcfcfc66"
        className="mb-4 rounded-xl border border-hairline bg-panel px-4 py-3 text-[15px] text-ink"
        style={inputStyle}
      />

      <View className="mb-6 flex-row items-center justify-between rounded-xl border border-hairline bg-panel px-4 py-3">
        <View className="mr-3 flex-1">
          <Text className="text-[15px] text-ink">Use mock channel</Text>
          <Text className="text-[12px] text-ink-secondary">
            Live WS/SSE client is stubbed — keep mock on until zakurabot ships.
          </Text>
        </View>
        <Switch
          value={useMock}
          onValueChange={setUseMock}
          trackColor={{ false: "#333", true: "#1084fe" }}
        />
      </View>

      <Pressable
        onPress={() => void onSave()}
        className="items-center rounded-xl bg-accent py-3.5"
      >
        <Text className="text-[15px] font-semibold text-ink">
          {saved ? "Saved" : "Save"}
        </Text>
      </Pressable>

      <Pressable onPress={() => router.back()} className="mt-3 items-center py-3">
        <Text className="text-[14px] text-ink-secondary">Close</Text>
      </Pressable>

      <Text className="mt-8 text-[12px] leading-5 text-ink-secondary">
        Tokens stay on-device (AsyncStorage). Never commit secrets. See
        docs/architecture.md for how this app will bind as platform{" "}
        <Text className="font-mono text-ink">zakurabot</Text> using{" "}
        <Text className="font-mono text-ink">chat_reply</Text>.
      </Text>
    </ScrollView>
  );
}
