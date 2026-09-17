import { useLayoutEffect, useRef } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { AlertTriangle, RefreshCw, Settings, WifiOff, X } from "lucide-react-native";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { useFocusOnRemoval } from "@/lib/use-focus-on-removal";
import { useRouter } from "expo-router";

/**
 * Top-of-thread banner for connection problems, channel errors and compact notices.
 */
export function StatusBanner({ onFocusLost, notice }: {
  onFocusLost: () => void;
  notice?: { message: string; onDismiss: () => void };
}) {
  const { connection, connectionDetail, lastError, reconnect, dismissError, settings, selectedId } =
    useStore();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const shortWindow = height < 400;

  const error = lastError && (!lastError.agentId || lastError.agentId === selectedId) ? lastError : null;
  const contentKey = JSON.stringify([connection, connection === "connected" ? error : connectionDetail, notice?.message]);
  // A short viewport has room for one status area. Keep the upload explanation
  // and connection recovery together instead of growing the composer footer.
  const noticeText = notice ? <Text className="text-[13px] leading-5 text-ink">{notice.message}</Text> : null;

  if (connection === "connected" && !error && !notice) return null;

  if (connection === "connecting") {
    return (
      <Banner key="connecting" tone="muted" contentKey={contentKey} onFocusLost={onFocusLost} icon={<ActivityIndicator size="small" color="#fcfcfc99" />}>
        {noticeText}
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
        key="connection-error"
        tone="danger"
        contentKey={contentKey}
        onFocusLost={onFocusLost}
        icon={<WifiOff size={14} color="#ff5667" />}
        action={
          <View className={cn("gap-1", shortWindow ? "flex-row" : "items-end")}><Pressable
            onPress={() => void reconnect()}
            accessibilityRole="button"
            accessibilityLabel="Reconnect"
            className={cn("min-h-11 flex-row items-center rounded-xl bg-raised active:bg-raised-hover",
              shortWindow ? "w-11 justify-center" : "gap-1 px-3 py-2")}
          >
            <RefreshCw size={shortWindow ? 16 : 12} color="#fcfcfc" />
            {!shortWindow ? <Text className="text-[12px] text-ink">Reconnect</Text> : null}
          </Pressable>
          {live ? <Pressable onPress={() => router.push("/settings")} accessibilityRole="button" accessibilityLabel="Edit connection settings"
            className={cn("min-h-11 justify-center rounded-xl active:bg-raised",
              shortWindow ? "w-11 items-center" : "px-3 py-2")}>
            {shortWindow ? <Settings size={16} color="#fcfcfc" /> : <Text className="text-[12px] text-ink">Settings</Text>}
          </Pressable> : null}</View>
        }
      >
        {noticeText}
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

  // Connected with an operation error or a local upload notice.
  return (
    <Banner
      key={notice ? "upload-notice" : "operation-error"}
      tone="warning"
      contentKey={contentKey}
      onFocusLost={onFocusLost}
      icon={<AlertTriangle size={14} color="#ff9800" />}
      action={
        <Pressable
          onPress={notice ? notice.onDismiss : dismissError}
          accessibilityRole="button"
          accessibilityLabel={notice ? "Dismiss attachment notice" : "Dismiss error"}
          className="h-11 w-11 items-center justify-center rounded-xl active:bg-raised"
        >
          <X size={14} color="#fcfcfc99" />
        </Pressable>
      }
    >
      {noticeText}
      {error ? <Text className="text-[13px] leading-5 text-ink">
        {error.message}
      </Text> : null}
    </Banner>
  );
}

function Banner({
  tone,
  icon,
  action,
  children,
  onFocusLost,
  contentKey,
}: {
  tone: "muted" | "danger" | "warning";
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  onFocusLost: () => void;
  contentKey: string;
}) {
  const { height } = useWindowDimensions();
  const shortWindow = height < 400;
  const setRef = useFocusOnRemoval(onFocusLost);
  const detailsRef = useRef<ScrollView>(null);
  useLayoutEffect(() => {
    // Reuse the focusable region, but do not leave a replacement explanation
    // scrolled to the end of the previous error. Ordinary renders keep its y.
    detailsRef.current?.scrollTo({ y: 0, animated: false });
  }, [contentKey]);
  return (
    <View ref={setRef}
      accessibilityLiveRegion="polite"
      accessibilityRole={tone === "muted" ? undefined : "alert"}
      className={cn(
        "mx-4 flex-row items-center gap-2 rounded-xl border px-3",
        shortWindow ? "mb-1 py-1" : "mb-2 py-2",
        tone === "muted" && "border-hairline bg-panel",
        tone === "danger" && "border-danger/40 bg-danger/10",
        tone === "warning" && "border-warning/40 bg-warning/10",
      )}
    >
      {icon}
      <ScrollView ref={detailsRef} className="min-w-0 flex-1" style={{ maxHeight: shortWindow ? 44 : Math.min(180, height * 0.25) }}
        accessibilityLabel="Channel status details" role={Platform.OS === "web" ? "region" : undefined}
        tabIndex={Platform.OS === "web" ? 0 : undefined} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {action}
    </View>
  );
}
