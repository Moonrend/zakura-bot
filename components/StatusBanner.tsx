import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { AlertTriangle, RefreshCw, WifiOff, X } from "lucide-react-native";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";

/**
 * Top-of-thread banner for connection problems and channel errors.
 * Renders nothing when connected and error-free.
 */
export function StatusBanner() {
  const { connection, connectionDetail, lastError, reconnect, dismissError, settings, selectedId } =
    useStore();

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
          <Pressable
            onPress={() => void reconnect()}
            accessibilityRole="button"
            accessibilityLabel="Reconnect"
            className="flex-row items-center gap-1 rounded-full bg-raised px-2.5 py-1 active:bg-raised-hover"
          >
            <RefreshCw size={12} color="#fcfcfc" />
            <Text className="text-[12px] text-ink">Reconnect</Text>
          </Pressable>
        }
      >
        <Text className="text-[13px] text-ink" numberOfLines={2}>
          {connection === "error" ? "Channel error" : "Disconnected"}
          {connectionDetail ? ` · ${connectionDetail}` : ""}
        </Text>
        {live ? (
          <Text className="text-[11px] text-ink-secondary" numberOfLines={2}>
            Live mode needs the zakurabot platform on the server. Switch back to mock in Settings.
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
          className="rounded-full p-1 active:bg-raised"
        >
          <X size={14} color="#fcfcfc99" />
        </Pressable>
      }
    >
      <Text className="text-[13px] text-ink" numberOfLines={3}>
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
  return (
    <View
      accessibilityLiveRegion="polite"
      className={cn(
        "mx-4 mb-2 flex-row items-center gap-2 rounded-xl border px-3 py-2",
        tone === "muted" && "border-hairline bg-panel",
        tone === "danger" && "border-danger/40 bg-danger/10",
        tone === "warning" && "border-warning/40 bg-warning/10",
      )}
    >
      {icon}
      <View className="min-w-0 flex-1">{children}</View>
      {action}
    </View>
  );
}
