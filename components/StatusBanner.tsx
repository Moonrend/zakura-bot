import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { AlertTriangle, RefreshCw, WifiOff, X } from "lucide-react-native";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { useRouter } from "expo-router";

/**
 * Top-of-thread banner for connection problems and channel errors.
 * Renders nothing when connected and error-free.
 */
export function StatusBanner() {
  const { connection, connectionDetail, lastError, reconnect, dismissError, settings, selectedId } =
    useStore();
  const router = useRouter();

  const error = lastError && (!lastError.agentId || lastError.agentId === selectedId) ? lastError : null;

  if (connection === "connected" && !error) return null;

  if (connection === "connecting") {
    return (
      <Banner tone="muted" icon={<ActivityIndicator size="small" color="#fcfcfc99" />}>
        <Text className="text-[13px] text-ink-secondary">
          Connecting to Zakura{connectionDetail ? ` · ${connectionDetail}` : "…"}
        </Text>
      </Banner>
    );
  }

  if (connection === "error" || connection === "disconnected") {
    const live = !settings.useMockChannel;
    return (
      <Banner
        tone="danger"
        icon={<WifiOff size={14} color="#ff5667" />}
        action={
          <View className="items-end gap-1"><Pressable
            onPress={() => void reconnect()}
            accessibilityRole="button"
            accessibilityLabel="Reconnect"
            className="min-h-11 flex-row items-center gap-1 rounded-xl bg-raised px-3 py-2 active:bg-raised-hover"
          >
            <RefreshCw size={12} color="#fcfcfc" />
            <Text className="text-[12px] text-ink">Reconnect</Text>
          </Pressable>
          {live ? <Pressable onPress={() => router.push("/settings")} accessibilityRole="button" accessibilityLabel="Edit connection settings"
            className="min-h-11 justify-center rounded-xl px-3 py-2 active:bg-raised"><Text className="text-[12px] text-ink">Settings</Text></Pressable> : null}</View>
        }
      >
        <Text className="text-[13px] leading-5 text-ink">
          {connection === "error" ? "Channel error" : "Disconnected"}
          {connectionDetail ? ` · ${connectionDetail}` : ""}
        </Text>
        {live ? (
          <Text className="mt-1 text-[12px] leading-5 text-ink-secondary">
            Check your connection settings or use the mock channel to try the demo.
          </Text>
        ) : null}
      </Banner>
    );
  }

  // connected + error
  return (
    <Banner
      tone="warning"
      icon={<AlertTriangle size={14} color="#ff9800" />}
      action={
        <Pressable
          onPress={dismissError}
          accessibilityRole="button"
          accessibilityLabel="Dismiss error"
          className="h-11 w-11 items-center justify-center rounded-xl active:bg-raised"
        >
          <X size={14} color="#fcfcfc99" />
        </Pressable>
      }
    >
      <Text className="text-[13px] leading-5 text-ink">
        {error?.message}
      </Text>
    </Banner>
  );
}

function Banner({
  tone,
  icon,
  action,
  children,
}: {
  tone: "muted" | "danger" | "warning";
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { height } = useWindowDimensions();
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole={tone === "muted" ? undefined : "alert"}
      className={cn(
        "mx-4 mb-2 flex-row items-center gap-2 rounded-xl border px-3 py-2",
        tone === "muted" && "border-hairline bg-panel",
        tone === "danger" && "border-danger/40 bg-danger/10",
        tone === "warning" && "border-warning/40 bg-warning/10",
      )}
    >
      {icon}
      <ScrollView className="min-w-0 flex-1" style={{ maxHeight: Math.max(48, Math.min(180, height * 0.25)) }}
        accessibilityLabel="Channel status details" role={Platform.OS === "web" ? "region" : undefined}
        tabIndex={Platform.OS === "web" ? 0 : undefined} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {action}
    </View>
  );
}
