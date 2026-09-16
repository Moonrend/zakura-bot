import { View, useWindowDimensions, Pressable } from "react-native";
import { AgentSidebar } from "@/components/AgentSidebar";
import { ChatPane } from "@/components/ChatPane";
import { useStore } from "@/lib/store";

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const compact = width < 768;
  const { sidebarOpen, setSidebarOpen } = useStore();

  const showSidebar = !compact || sidebarOpen;

  return (
    <View className="flex-1 flex-row bg-app">
      {showSidebar ? (
        <View
          className={compact ? "absolute bottom-0 left-0 top-0 z-20 w-[86%] max-w-sm" : "w-80"}
          style={compact ? { elevation: 8 } : undefined}
        >
          <AgentSidebar />
        </View>
      ) : null}
      {compact && sidebarOpen ? (
        <Pressable
          className="absolute inset-0 z-10 bg-black/50"
          onPress={() => setSidebarOpen(false)}
        />
      ) : null}
      <View className="flex-1">
        <ChatPane />
      </View>
    </View>
  );
}
