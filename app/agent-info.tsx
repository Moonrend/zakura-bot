import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentInfoPane } from "@/components/AgentInfoPane";

export default function AgentInfoScreen() {
  const params = useLocalSearchParams<{ agentId?: string }>();
  const agentId = typeof params.agentId === "string" ? params.agentId : undefined;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const close = () => router.canGoBack() ? router.back() : router.replace("/");
  return <View className="flex-1 bg-app" style={{ paddingTop: Math.max(insets.top, 12), paddingBottom: Math.max(insets.bottom, 12) }}>
    <AgentInfoPane agentId={agentId} onClose={close} />
  </View>;
}
