import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { ArrowDown, Menu } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlobAvatar } from "./BlobAvatar";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import { StatusBanner } from "./StatusBanner";
import { formatDay, formatTime, useStore } from "@/lib/store";
import type { ChatMessage } from "@/lib/types";

const SUGGESTIONS = ["Say hello", "How do settings work?", "Run a slow reply", "help"];

export function ChatPane() {
  const {
    agents,
    selectedId,
    messagesByAgent,
    typing,
    sidebarOpen,
    setSidebarOpen,
    retryMessage,
    send,
    connection,
    transportLabel,
  } = useStore();
  const agent = agents.find((a) => a.id === selectedId) ?? agents[0];
  const messages = messagesByAgent[agent?.id ?? ""] ?? [];
  const busy = !!typing[agent?.id ?? ""];
  const scrollRef = useRef<ScrollView>(null);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = width < 768;
  const [pinned, setPinned] = useState(true);

  // Keep the newest message visible while the user is pinned to the bottom.
  const lastText = messages.length ? messages[messages.length - 1].text : undefined;
  useEffect(() => {
    if (!pinned) return;
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 30);
    return () => clearTimeout(t);
  }, [messages.length, lastText, busy, pinned]);

  // Switching threads always jumps to the bottom.
  useEffect(() => {
    setPinned(true);
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 0);
    return () => clearTimeout(t);
  }, [selectedId]);

  const onScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const distance = contentSize.height - layoutMeasurement.height - contentOffset.y;
      setPinned(distance < 80);
    },
    [],
  );

  const rows = useMemo(() => buildRows(messages), [messages]);

  if (!agent) {
    return (
      <View className="flex-1 items-center justify-center bg-app">
        <Text className="text-ink-secondary">No agent selected</Text>
      </View>
    );
  }

  const statusText =
    agent.status === "offline"
      ? "Offline"
      : busy
        ? "Working…"
        : connection === "connected"
          ? `${transportLabel} · ${agent.title ?? "Agent"}`
          : agent.title ?? "Agent";

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-app"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <View
        className="flex-row items-center justify-between border-b border-hairline/60 px-4 pb-2.5"
        style={{ paddingTop: Math.max(insets.top, 12) }}
      >
        <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
          {compact && !sidebarOpen ? (
            <Pressable
              onPress={() => setSidebarOpen(true)}
              className="-ml-1 mr-0.5 rounded-md p-1.5 active:bg-raised"
              accessibilityRole="button"
              accessibilityLabel="Open agent list"
            >
              <Menu size={20} color="#fcfcfc" />
            </Pressable>
          ) : null}
          <BlobAvatar color={agent.color} name={agent.name} size={30} />
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-semibold text-ink" numberOfLines={1}>
              {agent.name}
            </Text>
            <View className="flex-row items-center gap-1.5">
              {busy ? <ActivityIndicator size={10} color="#fcfcfc99" /> : null}
              <Text className="text-[11px] text-ink-secondary" numberOfLines={1}>
                {statusText}
              </Text>
            </View>
          </View>
        </View>
      </View>

      <View className="flex-1">
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          onScroll={onScroll}
          scrollEventThrottle={64}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingTop: 12,
            paddingBottom: 16,
            paddingHorizontal: 16,
            maxWidth: 900,
            width: "100%",
            alignSelf: "center",
          }}
        >
          <StatusBanner />
          {rows.length === 0 ? (
            <EmptyThread
              name={agent.name}
              color={agent.color}
              offline={agent.status === "offline"}
              onSuggest={(s) => void send(s)}
            />
          ) : null}
          {rows.map((row) =>
            row.kind === "day" ? (
              <View key={row.key} className="my-3 flex-row items-center gap-3">
                <View className="h-px flex-1 bg-hairline/70" />
                <Text className="text-[11px] text-ink-secondary">
                  {row.label} · {row.time}
                </Text>
                <View className="h-px flex-1 bg-hairline/70" />
              </View>
            ) : (
              <MessageBubble
                key={row.message.id}
                message={row.message}
                grouped={row.grouped}
                onRetry={(id) => void retryMessage(id)}
              />
            ),
          )}
          {busy && !messages.some((m) => m.streaming) ? (
            <View
              className="mb-2 flex-row items-center gap-2 pl-1"
              accessibilityLiveRegion="polite"
              accessibilityLabel={`${agent.name} is working`}
            >
              <TypingDots />
              <Text className="text-[12px] text-ink-secondary">{agent.name} is working…</Text>
            </View>
          ) : null}
        </ScrollView>

        {!pinned ? (
          <Pressable
            onPress={() => {
              setPinned(true);
              scrollRef.current?.scrollToEnd({ animated: true });
            }}
            accessibilityRole="button"
            accessibilityLabel="Jump to latest"
            className="absolute bottom-3 right-4 h-9 w-9 items-center justify-center rounded-full border border-hairline bg-raised active:bg-raised-hover"
          >
            <ArrowDown size={16} color="#fcfcfc" />
          </Pressable>
        ) : null}
      </View>

      <Composer agentName={agent.name} busy={busy} bottomInset={insets.bottom} />
    </KeyboardAvoidingView>
  );
}

type Row =
  | { kind: "day"; key: string; label: string; time: string }
  | { kind: "msg"; message: ChatMessage; grouped: boolean };

/** Insert day separators and mark consecutive same-author bubbles as grouped. */
function buildRows(messages: ChatMessage[]): Row[] {
  const rows: Row[] = [];
  let lastDay = "";
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const day = formatDay(m.createdAt);
    if (day !== lastDay) {
      rows.push({ kind: "day", key: `day_${m.id}`, label: day, time: formatTime(m.createdAt) });
      lastDay = day;
    }
    const next = messages[i + 1];
    const grouped =
      !!next &&
      next.kind === "text" &&
      m.kind === "text" &&
      next.role === m.role &&
      next.createdAt - m.createdAt < 60_000;
    rows.push({ kind: "msg", message: m, grouped });
  }
  return rows;
}

function EmptyThread({
  name,
  color,
  offline,
  onSuggest,
}: {
  name: string;
  color: string;
  offline: boolean;
  onSuggest: (text: string) => void;
}) {
  return (
    <View className="items-center px-4 py-14">
      <BlobAvatar color={color} name={name} size={64} />
      <Text className="mt-4 text-[17px] font-semibold text-ink">{name}</Text>
      <Text className="mt-1 text-center text-[13px] text-ink-secondary">
        {offline
          ? "This agent is offline. Messages you send will be queued when the zakurabot channel is live."
          : "Send a message to start the thread."}
      </Text>
      <View className="mt-6 flex-row flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <Pressable
            key={s}
            onPress={() => onSuggest(s)}
            accessibilityRole="button"
            className="rounded-full border border-hairline bg-panel px-3.5 py-2 active:bg-raised"
          >
            <Text className="text-[13px] text-ink">{s}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function TypingDots() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 3), 350);
    return () => clearInterval(id);
  }, []);
  return (
    <View className="flex-row items-center gap-1">
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-ink"
          style={{ opacity: tick === i ? 0.9 : 0.3 }}
        />
      ))}
    </View>
  );
}
