import { Pressable, ScrollView, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentForm } from "@/components/AgentForm";
import { useStore } from "@/lib/store";

const CIRCLE = "h-11 w-11 items-center justify-center rounded-full bg-raised active:bg-raised-hover";
const ICON = "#d4d4d4";

export default function NewBotScreen() {
  const { selectAgent } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const close = () => { if (router.canGoBack()) router.back(); else router.replace("/bots"); };
  return <ScrollView className="flex-1 bg-app" keyboardShouldPersistTaps="handled"
    contentContainerStyle={{ padding: 16, paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 24), maxWidth: 680, width: "100%", alignSelf: "center" }}>
    <View className="mb-4 flex-row items-center justify-between">
      <Pressable accessibilityRole="button" accessibilityLabel="Close new agent" onPress={close} className={CIRCLE}>
        <X size={20} color={ICON} />
      </Pressable>
    </View>
    <Text accessibilityRole="header" className="mb-3 px-4 text-[13px] text-ink-secondary">New agent</Text>
    <View className="rounded-3xl bg-panel p-4">
      <AgentForm onCancel={close} onSaved={(agent) => { selectAgent(agent.id); close(); }} />
    </View>
  </ScrollView>;
}
