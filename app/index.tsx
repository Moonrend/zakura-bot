import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, View, useWindowDimensions, Pressable } from "react-native";
import { useFocusEffect } from "expo-router";
import { AgentSidebar } from "@/components/AgentSidebar";
import { ChatPane } from "@/components/ChatPane";
import { useStore } from "@/lib/store";
import { useFocusOnRemoval } from "@/lib/use-focus-on-removal";

export default function HomeScreen() {
  const { width, height } = useWindowDimensions();
  const compact = width < 768;
  const { sidebarOpen, setSidebarOpen, settingsReady, setThreadVisible } = useStore();
  // The desktop sidebar and modal have different lifetimes. Keep the user's
  // filters with the screen so resizing or reopening the drawer retains them.
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const filters = { query, setQuery, unreadOnly, setUnreadOnly };
  const desktopSidebarRef = useRef<View | null>(null);
  const agentListButtonRef = useRef<View | null>(null);
  const restoreSidebarFocus = useCallback(() => {
    if (Platform.OS !== "web") return;
    const sidebar = desktopSidebarRef.current as unknown as HTMLElement | null;
    const list = sidebar?.querySelector<HTMLElement>('[role="region"][aria-label="Agent list"]');
    const menu = agentListButtonRef.current as unknown as HTMLElement | null;
    (list ?? menu)?.focus({ preventScroll: true });
  }, []);
  const setDesktopRemovalRef = useFocusOnRemoval(restoreSidebarFocus);
  const setDrawerRemovalRef = useFocusOnRemoval(restoreSidebarFocus);
  const setMenuRemovalRef = useFocusOnRemoval(restoreSidebarFocus);
  const setDesktopSidebarRef = useCallback((node: View | null) => {
    setDesktopRemovalRef(node);
    desktopSidebarRef.current = node;
  }, [setDesktopRemovalRef]);
  const setAgentListButtonRef = useCallback((node: View | null) => {
    setMenuRemovalRef(node);
    agentListButtonRef.current = node;
  }, [setMenuRemovalRef]);

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
        <View ref={setDesktopSidebarRef} className="w-80 shrink-0">
          <AgentSidebar {...filters} />
        </View>
      ) : null}
      <View className="min-w-0 flex-1" accessibilityElementsHidden={compact && sidebarOpen}
        importantForAccessibility={compact && sidebarOpen ? "no-hide-descendants" : "auto"}>
        <ChatPane agentListButtonRef={setAgentListButtonRef} />
      </View>
      <Modal transparent visible={compact && sidebarOpen} animationType="none"
        onRequestClose={() => setSidebarOpen(false)} statusBarTranslucent>
        {/* Web modals render outside the app root, so they need the same
            visible-height constraint when the search keyboard opens. */}
        <View className="flex-1" accessibilityViewIsModal style={Platform.OS === "web" ? { maxHeight: height } : undefined}>
          <Pressable className="absolute inset-0 bg-black/60" onPress={() => setSidebarOpen(false)}
            accessible={false} focusable={false} />
          <View ref={setDrawerRemovalRef} className="h-full" style={{ width: Math.min(320, Math.max(240, width - 48)) }}>
            <AgentSidebar {...filters} />
          </View>
        </View>
      </Modal>
    </View>
  );
}
