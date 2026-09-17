import { useCallback, useEffect } from "react";
import { ActivityIndicator, Modal, View, useWindowDimensions, Pressable } from "react-native";
import { useFocusEffect } from "expo-router";
import { AgentSidebar } from "@/components/AgentSidebar";
import { ChatPane } from "@/components/ChatPane";
import { useStore } from "@/lib/store";

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const compact = width < 768;
  const { sidebarOpen, setSidebarOpen, settingsReady, setThreadVisible } = useStore();

  useEffect(() => {
    // The desktop sidebar replaces the drawer; do not reopen an old drawer
    // when rotating or resizing back to a compact layout.
    if (!compact) setSidebarOpen(false);
  }, [compact, setSidebarOpen]);

  useFocusEffect(useCallback(() => {
    setThreadVisible(!compact || !sidebarOpen);
    return () => setThreadVisible(false);
  }, [compact, sidebarOpen, setThreadVisible]));

  if (!settingsReady) {
    return <View className="flex-1 items-center justify-center bg-app" accessibilityLabel="Loading Zakura Bot">
      <ActivityIndicator color="#a8a8a8" />
    </View>;
  }

  return (
    <View className="flex-1 flex-row bg-app">
      {!compact ? (
        <View className="w-80 shrink-0">
          <AgentSidebar />
        </View>
      ) : null}
      <View className="min-w-0 flex-1" accessibilityElementsHidden={compact && sidebarOpen}
        importantForAccessibility={compact && sidebarOpen ? "no-hide-descendants" : "auto"}>
        <ChatPane />
      </View>
      <Modal transparent visible={compact && sidebarOpen} animationType="none"
        onRequestClose={() => setSidebarOpen(false)} statusBarTranslucent>
        <View className="flex-1" accessibilityViewIsModal>
          <Pressable className="absolute inset-0 bg-black/60" onPress={() => setSidebarOpen(false)}
            accessible={false} focusable={false} />
          <View className="h-full" style={{ width: Math.min(320, Math.max(240, width - 48)) }}>
            <AgentSidebar />
          </View>
        </View>
      </Modal>
    </View>
  );
}
