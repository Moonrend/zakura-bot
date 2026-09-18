import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { ArrowDown, Menu, Settings, Monitor } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlobAvatar } from "./BlobAvatar";
import { MessageBubble } from "./MessageBubble";
import { ActivityChip } from "./ActivityChip";
import { Composer } from "./Composer";
import { StatusBanner } from "./StatusBanner";
import { formatDay, useStore } from "@/lib/store";
import { previewFromMessages } from "@/lib/chat-state";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { useFocusOnRemoval } from "@/lib/use-focus-on-removal";
import { UPLOAD_NOTICE } from "@/lib/use-file-drop-guard";
import type { ChatMessage } from "@/lib/types";
import { interactionPending } from "@/lib/interactions";

const EMPTY_MESSAGES: ChatMessage[] = [];
const HISTORY_PAGE_SIZE = 50;
type HistoryStart = { agentId: string; id: string };
type HistoryAnchor = { agentId: string; height: number; y: number; element?: HTMLElement; offset?: number };

export function ChatPane({ agentListButtonRef }: { agentListButtonRef?: Ref<View> }) {
  const { agents, selectedId, messagesByAgent, typing, setSidebarOpen, retryMessage, connection } = useStore();
  const agent = agents.find((item) => item.id === selectedId);
  const allMessages = messagesByAgent[selectedId] ?? EMPTY_MESSAGES;
  // Tool events never become transcript rows, dates, quotes or history pages.
  const messages = useMemo(() => allMessages.filter((message) => message.kind !== "activity"), [allMessages]);
  const activeTool = [...allMessages].reverse().find((message) => message.kind === "activity" &&
    message.tool && message.tool.ok === undefined && !message.tool.interrupted)?.tool;
  const busy = !!typing[selectedId];
  const deliveryPending = messages.some((message) => message.pending);
  const pendingRequests = messages.filter((message) => message.interaction && interactionPending(message.interaction));
  const scrollRef = useRef<ScrollView>(null);
  const scrollFrame = useRef<number | null>(null);
  const { width, height } = useWindowDimensions();
  const compact = width < 768;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  // Update animation preferences without resetting the thread's reading position.
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const [pinned, setPinned] = useState(true);
  const pinnedRef = useRef(true);
  const readingSelection = useRef(false);
  const lastScrollY = useRef(0);
  const viewportHeight = useRef(0);
  const contentHeight = useRef(0);
  const [historyStart, setHistoryStart] = useState<HistoryStart | null>(null);
  const [loadedCount, setLoadedCount] = useState(0);
  const [attachmentNoticeAgent, setAttachmentNoticeAgent] = useState<string | null>(null);
  const attachmentNotice = !!selectedId && attachmentNoticeAgent === selectedId;
  const setAttachmentNotice = useCallback((visible: boolean) => {
    setAttachmentNoticeAgent(visible ? selectedId : null);
  }, [selectedId]);
  const firstVisibleMessage = useRef<HistoryStart | null>(null);
  const historyAnchor = useRef<HistoryAnchor | null>(null);
  const requestPositions = useRef(new Map<string, number>());
  const requestToReveal = useRef<string | null>(null);
  const recentStart = Math.max(0, messages.length - HISTORY_PAGE_SIZE);
  const rememberedStart = historyStart?.agentId === selectedId ? messages.findIndex((message) => message.id === historyStart.id) : -1;
  const visibleStart = rememberedStart < 0 ? recentStart : Math.min(recentStart, rememberedStart);
  const visibleMessages = useMemo(() => messages.slice(visibleStart), [messages, visibleStart]);

  useLayoutEffect(() => {
    firstVisibleMessage.current = visibleMessages[0] ? { agentId: selectedId, id: visibleMessages[0].id } : null;
  }, [selectedId, visibleMessages]);

  const keepVisibleHistory = useCallback(() => {
    const first = firstVisibleMessage.current;
    if (first?.agentId !== selectedId) return;
    // Once someone reads or expands history, incoming messages must not evict
    // the oldest visible row. Keep an identity, not a count that moves on append.
    setHistoryStart((previous) => previous?.agentId === selectedId ? previous : first);
  }, [selectedId]);

  const focusTranscript = useCallback(() => {
    if (Platform.OS === "web") {
      const node = scrollRef.current?.getScrollableNode() as HTMLElement | null | undefined;
      node?.focus({ preventScroll: true });
    }
  }, []);
  const setConversationRef = useFocusOnRemoval(focusTranscript);
  const setJumpRef = useFocusOnRemoval(focusTranscript);

  const scrollToLatest = useCallback((animated = false) => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      if (!pinnedRef.current) return;
      const node = Platform.OS === "web" ? scrollRef.current?.getScrollableNode() as HTMLElement | undefined : undefined;
      if (Platform.OS === "web" ? !node?.clientHeight : viewportHeight.current <= 0) return;
      const animate = animated && !reducedMotionRef.current;
      scrollRef.current?.scrollToEnd({ animated: animate });
      if (Platform.OS === "web" && !animate) {
        // RN Web throttles scroll events. Record an immediate follow scroll
        // before a quick upward wheel gesture can be compared to the old y.
        if (node) lastScrollY.current = node.scrollTop;
      }
    });
  }, []);

  const pinToLatest = useCallback((animated = false) => {
    // Sending or explicitly jumping to the end resumes following even if a
    // keyboard action left the old text selection in place.
    readingSelection.current = false;
    pinnedRef.current = true;
    setPinned(true);
    scrollToLatest(animated);
  }, [scrollToLatest]);

  const pauseFollowing = useCallback(() => {
    // An explicit reading action takes precedence over a queued follow scroll.
    keepVisibleHistory();
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
    pinnedRef.current = false;
    setPinned(false);
  }, [keepVisibleHistory]);

  const scrollToRequest = useCallback((id: string) => {
    const y = requestPositions.current.get(id);
    if (y === undefined) return;
    requestToReveal.current = null;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: false });
  }, []);
  const reviewRequest = () => {
    const message = pendingRequests[0];
    if (!message) return;
    pauseFollowing();
    requestToReveal.current = message.id;
    const index = messages.findIndex((item) => item.id === message.id);
    if (index < visibleStart) setHistoryStart({ agentId: selectedId, id: message.id });
    else scrollToRequest(message.id);
  };

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = scrollRef.current?.getScrollableNode() as HTMLElement | undefined;
    const keydown = (event: KeyboardEvent) => {
      if (!node || node.scrollHeight <= node.clientHeight || event.defaultPrevented || event.altKey || event.metaKey) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      // Native keyboard scrolling starts after keydown. Waiting for onScroll
      // lets a pending composer-resize follow move Home's target off the top.
      if (["Home", "PageUp", "ArrowUp"].includes(event.key) || (event.key === " " && event.shiftKey && event.target === node)) pauseFollowing();
    };
    node?.addEventListener("keydown", keydown);
    return () => node?.removeEventListener("keydown", keydown);
  }, [selectedId, pauseFollowing]);

  const followIfNearEnd = useCallback(() => {
    if (readingSelection.current) return;
    // Layout can grow the viewport without changing content or scroll offset
    // (for example, shortening a draft). Use current web geometry so concurrent
    // text wrapping and throttled scroll events cannot leave stale distances.
    const node = Platform.OS === "web" ? scrollRef.current?.getScrollableNode() as HTMLElement | undefined : undefined;
    // Navigation keeps the chat mounted but reports zero geometry while it
    // is hidden. That is not the end of the transcript; retain reading state
    // until a visible layout can decide whether following should resume.
    if (Platform.OS === "web" ? !node?.clientHeight : viewportHeight.current <= 0) return;
    const distance = node ? node.scrollHeight - node.clientHeight - node.scrollTop
      : contentHeight.current - viewportHeight.current - lastScrollY.current;
    if (pinnedRef.current || distance < 80) pinToLatest();
  }, [pinToLatest]);

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    if (height <= 0) return;
    contentHeight.current = height;
    const anchor = historyAnchor.current;
    if (Platform.OS !== "web" && anchor?.agentId === selectedId) {
      historyAnchor.current = null;
      const y = Math.max(0, anchor.y + height - anchor.height);
      lastScrollY.current = y;
      scrollRef.current?.scrollTo({ y, animated: false });
      return;
    }
    // A disappearing activity pill can also bring the end into view.
    followIfNearEnd();
  }, [followIfNearEnd, selectedId]);

  useEffect(() => {
    readingSelection.current = false;
    pinnedRef.current = true;
    lastScrollY.current = 0;
    historyAnchor.current = null;
    requestPositions.current.clear();
    requestToReveal.current = null;
    setHistoryStart(null);
    setLoadedCount(0);
    setAttachmentNoticeAgent(null);
    setPinned(true);
    scrollToLatest();
  }, [selectedId, scrollToLatest]);
  useEffect(() => () => { if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current); }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || !selectedId) return;
    const node = scrollRef.current?.getScrollableNode() as HTMLElement | undefined;
    const selectionChange = () => {
      const selection = window.getSelection();
      const reading = !!node && !!selection && !selection.isCollapsed && selection.rangeCount > 0 &&
        selection.getRangeAt(0).intersectsNode(node);
      if (reading === readingSelection.current) return;
      readingSelection.current = reading;
      if (reading) pauseFollowing();
      else followIfNearEnd();
    };
    // Selecting text is a reading action even without an upward scroll. Keep
    // small updates and delayed scroll events from resuming follow mid-copy.
    document.addEventListener("selectionchange", selectionChange);
    selectionChange();
    return () => document.removeEventListener("selectionchange", selectionChange);
  }, [selectedId, pauseFollowing, followIfNearEnd]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    if (layoutMeasurement.height <= 0 || (Platform.OS === "web" &&
      !(scrollRef.current?.getScrollableNode() as HTMLElement | undefined)?.clientHeight)) return;
    const distance = contentSize.height - layoutMeasurement.height - contentOffset.y;
    // Growing content must not be mistaken for the user scrolling upwards.
    const next = readingSelection.current ? false : distance < 80 ? true : contentOffset.y < lastScrollY.current - 1 ? false : pinnedRef.current;
    lastScrollY.current = contentOffset.y;
    if (pinnedRef.current !== next) {
      if (!next) keepVisibleHistory();
      pinnedRef.current = next;
      setPinned(next);
    }
  }, [keepVisibleHistory]);
  const rows = useMemo(() => buildRows(visibleMessages), [visibleMessages]);

  const loadEarlier = () => {
    if (!visibleStart || historyAnchor.current) return;
    const node = Platform.OS === "web" ? scrollRef.current?.getScrollableNode() as HTMLElement | undefined : undefined;
    const top = node?.getBoundingClientRect().top ?? 0;
    const element = node ? Array.from(node.querySelectorAll<HTMLElement>('[data-testid^="transcript-row-"]'))
      .find((row) => row.getBoundingClientRect().bottom > top) : undefined;
    historyAnchor.current = { agentId: selectedId, height: node?.scrollHeight ?? contentHeight.current,
      y: node?.scrollTop ?? lastScrollY.current, element, offset: element ? element.getBoundingClientRect().top - top : undefined };
    const start = Math.max(0, visibleStart - HISTORY_PAGE_SIZE);
    pauseFollowing();
    const loaded = visibleStart - start;
    setHistoryStart({ agentId: selectedId, id: messages[start].id });
    setLoadedCount(loaded);
    // The control moves above the inserted page, or disappears on the last
    // page. Keyboard reading continues from the same place in the transcript.
    focusTranscript();
  };

  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const anchor = historyAnchor.current;
    if (!anchor || anchor.agentId !== selectedId) return;
    historyAnchor.current = null;
    const node = scrollRef.current?.getScrollableNode() as HTMLElement | undefined;
    if (!node) return;
    // Browser anchoring may already have moved the viewport. Measure the row
    // itself so concurrent live appends are not counted as prepended history.
    node.scrollTop = anchor.element?.isConnected && anchor.offset !== undefined
      ? node.scrollTop + anchor.element.getBoundingClientRect().top - node.getBoundingClientRect().top - anchor.offset
      : anchor.y + node.scrollHeight - anchor.height;
    lastScrollY.current = node.scrollTop;
  }, [rows, selectedId]);
  const replyTargets = useMemo(() => {
    const targets = new Map<string, ChatMessage>();
    for (const message of messages) {
      targets.set(message.id, message);
      if (message.serverId) targets.set(message.serverId, message);
      if (message.clientMessageId) targets.set(message.clientMessageId, message);
    }
    return targets;
  }, [messages]);
  const lastReply = [...messages].reverse().find((message) => message.role === "assistant" && message.kind === "text" && !message.streaming);
  const lastReplySummary = lastReply ? previewFromMessages([lastReply]) ?? (lastReply.interrupted ? "Stopped" : "Empty reply") : undefined;

  return (
    <KeyboardAvoidingView className="min-w-0 flex-1 bg-app" behavior={Platform.OS === "ios" ? "padding" : Platform.OS === "android" ? "height" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}>
      <View className="flex-row items-center gap-2.5 px-4 pb-2"
        style={{ paddingTop: Math.max(insets.top, 12) }}>
        {compact ? <Pressable ref={agentListButtonRef} onPress={() => setSidebarOpen(true)} className="-ml-2 h-11 w-11 items-center justify-center rounded-xl active:bg-raised"
          accessibilityRole="button" accessibilityLabel="Open agent list"><Menu size={21} color="#fcfcfc" /></Pressable> : null}
        {agent ? <BlobAvatar color={agent.color} name={agent.name} size={32} /> : null}
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold text-ink" numberOfLines={1} accessibilityRole="header">{agent?.name ?? "Zakura Bot"}</Text>
        </View>
        {agent ? <Pressable onPress={() => router.push({ pathname: "/desktop", params: { agentId: agent.id } })} accessibilityRole="button" accessibilityLabel="View bot desktop"
          className="h-11 w-11 items-center justify-center rounded-xl active:bg-raised"><Monitor size={18} color="#fcfcfc" /></Pressable> : null}
      </View>

      <View className="mx-auto w-full max-w-4xl pt-3"><StatusBanner onFocusLost={focusTranscript}
        notice={height < 400 && attachmentNotice ? { message: UPLOAD_NOTICE, onDismiss: () => setAttachmentNotice(false) } : undefined} /></View>
      <View key={selectedId} ref={setConversationRef} className="min-h-0 min-w-0 flex-1">
        {!agent ? (
          <ScrollView ref={scrollRef} className="min-h-0 flex-1" accessibilityLabel="Channel setup"
            role={Platform.OS === "web" ? "region" : undefined} tabIndex={Platform.OS === "web" ? 0 : undefined}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingVertical: 32 }}>
            <Text className="text-center text-[16px] text-ink">{connection === "connecting" ? "Connecting…" : "No bots yet"}</Text>
            <Pressable onPress={() => router.push("/settings")} accessibilityRole="button" accessibilityLabel="Open connection settings"
              className="mt-4 min-h-11 items-center justify-center px-4">
              <Text className="text-[14px] text-ink-secondary">Settings</Text>
            </Pressable>
          </ScrollView>
        ) : <>
          <View className="min-h-0 min-w-0 flex-1">
            <ScrollView ref={scrollRef} testID="chat-transcript" className={`min-w-0 flex-1${pinned ? " transcript-following" : ""}`}
              role={Platform.OS === "web" ? "region" : undefined} tabIndex={Platform.OS === "web" ? 0 : undefined}
              accessibilityLabel={`Conversation with ${agent.name}`} onScroll={onScroll} scrollEventThrottle={32}
              onContentSizeChange={onContentSizeChange}
              onLayout={(event) => {
                viewportHeight.current = event.nativeEvent.layout.height;
                followIfNearEnd();
              }}
              // On web, on-drag also dismisses focus for programmatic auto-scroll.
              keyboardDismissMode={Platform.OS === "web" ? "none" : Platform.OS === "ios" ? "interactive" : "on-drag"} keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingTop: 8, paddingBottom: 20, paddingHorizontal: compact ? 12 : 24,
                maxWidth: 900, width: "100%", alignSelf: "center", flexGrow: rows.length === 0 ? 1 : undefined }}>
              {visibleStart > 0 || loadedCount ? <View className="mb-3 items-center gap-2">
                {visibleStart > 0 ? <Pressable onPress={loadEarlier} accessibilityRole="button" accessibilityLabel="Load earlier messages"
                  className="min-h-11 justify-center px-4 py-2">
                  <Text className="text-[13px] text-ink-secondary">Earlier</Text>
                </Pressable> : null}
                <Text accessibilityLiveRegion="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 }}>
                  {loadedCount > 0
                    ? visibleStart > 0
                      ? `${loadedCount} earlier messages loaded. ${visibleStart} more available.`
                      : `${loadedCount} earlier messages loaded. All available history is shown.`
                    : visibleStart > 0 ? `${visibleStart} earlier messages available` : ""}
                </Text>
              </View> : null}
              {rows.length === 0 && !activeTool ? <EmptyThread name={agent.name} color={agent.color} offline={agent.status === "offline"} /> : null}
              {rows.map((row) => row.kind === "day" ? (
                <View key={row.key} className="my-3 items-center">
                  <Text className="text-[11px] text-ink-secondary">{row.label}</Text>
                </View>
              ) : <View key={`message_${row.message.id}`} testID={`transcript-row-${row.message.id}`}
                onLayout={row.message.interaction ? (event) => {
                  requestPositions.current.set(row.message.id, event.nativeEvent.layout.y);
                  if (requestToReveal.current === row.message.id) scrollToRequest(row.message.id);
                } : undefined}>
                <MessageBubble message={row.message} grouped={row.grouped} reducedMotion={reducedMotion}
                replyTarget={row.message.replyTo ? replyTargets.get(row.message.replyTo) : undefined}
                retryDisabled={connection !== "connected" || busy || deliveryPending || agent.status === "offline"}
                onRetry={(id) => void retryMessage(id)} onFocusLost={focusTranscript} />
              </View>)}
              {activeTool ? <ActivityChip tool={activeTool} reducedMotion={reducedMotion} /> : null}
            </ScrollView>
            {!pinned ? <Pressable ref={setJumpRef} onPress={() => {
              pinToLatest(true);
              // The button disappears after activation. Keep keyboard navigation
              // in the transcript instead of letting focus fall back to the page.
              focusTranscript();
            }}
              accessibilityRole="button" accessibilityLabel="Jump to latest"
              className="absolute bottom-3 right-4 h-11 w-11 items-center justify-center rounded-full border border-hairline bg-raised active:bg-raised-hover">
              <ArrowDown size={19} color="#fcfcfc" />
            </Pressable> : null}
          </View>
          <Text accessibilityLiveRegion="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 }}>
            {busy ? `${agent.name} is replying.` : lastReply ? `${agent.name}${lastReply.interrupted ? " stopped" : " replied"}: ${lastReplySummary}` : "Ready for your message."}
          </Text>
          <Composer agentName={agent.name} busy={busy} deliveryPending={deliveryPending}
            pendingRequests={pendingRequests.length} onReviewRequest={reviewRequest}
            attachmentNotice={attachmentNotice} setAttachmentNotice={setAttachmentNotice}
            agentOffline={agent.status === "offline"} bottomInset={insets.bottom} onSubmit={() => pinToLatest()} />
        </>}
      </View>
    </KeyboardAvoidingView>
  );
}

type Row = { kind: "day"; key: string; label: string } | { kind: "msg"; message: ChatMessage; grouped: boolean };
function buildRows(messages: ChatMessage[]): Row[] {
  const rows: Row[] = [];
  let lastDay = "";
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    const day = new Date(message.createdAt).toDateString();
    if (day !== lastDay) { rows.push({ kind: "day", key: `day_${message.id}`, label: formatDay(message.createdAt) }); lastDay = day; }
    const next = messages[index + 1];
    const grouped = !!next && next.kind === "text" && message.kind === "text" && next.role === message.role &&
      new Date(next.createdAt).toDateString() === day && next.createdAt - message.createdAt < 60_000;
    rows.push({ kind: "msg", message, grouped });
  }
  return rows;
}

function EmptyThread({ name, color, offline }: {
  name: string; color: string; offline: boolean;
}) {
  return (
    <View className="flex-1 items-center justify-center px-4 py-12">
      <BlobAvatar color={color} name={name} size={56} />
      <Text className="mt-4 w-full text-center text-[18px] font-semibold text-ink" numberOfLines={2}>{name}</Text>
      {offline ? <Text className="mt-2 text-[13px] text-ink-secondary">Offline</Text> : null}
    </View>
  );
}
