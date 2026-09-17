import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, Platform, useWindowDimensions } from "react-native";
import { ArrowUp, Plus, Square } from "lucide-react-native";
import { useStore } from "@/lib/store";
import { MAX_MESSAGE_LENGTH } from "@/lib/channel";
import { cn } from "@/lib/cn";
import { containsFiles } from "@/lib/use-file-drop-guard";

export function Composer({ agentName, busy, deliveryPending = false, agentOffline = false, bottomInset = 0, onSubmit }: {
  agentName: string;
  busy: boolean;
  deliveryPending?: boolean;
  agentOffline?: boolean;
  bottomInset?: number;
  onSubmit: () => void;
}) {
  const { selectedId, draftsByAgent, setDraft, clearDraft, send, interrupt, interrupting, connection } = useStore();
  const text = draftsByAgent[selectedId] ?? "";
  const { height: windowHeight } = useWindowDimensions();
  const maxInputHeight = Math.max(44, Math.min(160, Math.floor(windowHeight * 0.25)));
  const [focused, setFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [height, setHeight] = useState(44);
  const [attachmentNotice, setAttachmentNotice] = useState(false);
  const sending = useRef(false);
  const filePastePending = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const actionRef = useRef<View | null>(null);
  const setActionRef = useCallback((node: View | null) => {
    // Changing Send/Stop removes the old control, including any held press.
    // Move its keyboard focus to the draft before that DOM node disappears.
    if (!node && Platform.OS === "web" && actionRef.current &&
      document.activeElement === (actionRef.current as unknown as HTMLElement)) inputRef.current?.focus();
    actionRef.current = node;
  }, []);
  const offline = connection !== "connected" || agentOffline;
  const stopping = !!interrupting[selectedId];
  const sendingMessage = submitting || deliveryPending;
  const canSend = text.trim().length > 0 && !busy && !offline && !sendingMessage;

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const input = inputRef.current as unknown as HTMLTextAreaElement | null;
    let pasteReset: ReturnType<typeof setTimeout> | undefined;
    const drop = (event: DragEvent) => {
      if (containsFiles(event.dataTransfer)) setAttachmentNotice(true);
    };
    const paste = (event: ClipboardEvent) => {
      filePastePending.current = false;
      if (!containsFiles(event.clipboardData)) return;
      if (!event.clipboardData?.getData("text/plain")) event.preventDefault();
      else {
        // Let the browser insert text (with selection/undo intact), but retain
        // the skipped-file notice through that paste's subsequent input event.
        filePastePending.current = true;
        if (pasteReset) clearTimeout(pasteReset);
        pasteReset = setTimeout(() => { filePastePending.current = false; }, 0);
      }
      setAttachmentNotice(true);
    };
    window.addEventListener("drop", drop);
    input?.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("drop", drop);
      input?.removeEventListener("paste", paste);
      if (pasteReset) clearTimeout(pasteReset);
    };
  }, []);

  const resizeWebInput = useCallback(() => {
    if (Platform.OS !== "web") return;
    const input = inputRef.current as unknown as HTMLTextAreaElement | null;
    if (!input) return;
    // scrollHeight is at least the current height. Reset before measuring so
    // deletion, sending and narrower/wider layouts can shrink as well as grow.
    input.style.height = "0px";
    const nextHeight = Math.min(maxInputHeight, Math.max(44, input.scrollHeight));
    input.style.height = `${nextHeight}px`;
    setHeight(nextHeight);
  }, [maxInputHeight]);
  useLayoutEffect(resizeWebInput, [text, resizeWebInput]);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof ResizeObserver === "undefined") return;
    const input = inputRef.current as unknown as HTMLTextAreaElement | null;
    if (!input) return;
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (input.clientWidth === width) return;
      width = input.clientWidth;
      resizeWebInput();
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [resizeWebInput]);

  const submit = async () => {
    if (!canSend || sending.current) return;
    const agentId = selectedId;
    const draft = text;
    sending.current = true;
    setSubmitting(true);
    onSubmit();
    try {
      const ok = await send(draft, agentId);
      if (ok) { clearDraft(agentId, draft); setAttachmentNotice(false); }
    } finally {
      sending.current = false;
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };

  const hint = attachmentNotice ? "File uploads aren’t available yet. Paste text or a link instead."
    : offline ? "Offline · your draft stays in this conversation"
    : stopping ? "Waiting for the agent to stop… Your draft stays here"
    : busy ? "You can draft your next message while the agent replies"
    : deliveryPending ? "Waiting for delivery confirmation… You can keep drafting"
      : Platform.OS === "web" ? "Enter to send · Shift+Enter for a new line" : "Write a message, then tap Send";

  return (
    <View className="px-4 pt-2" style={{ paddingBottom: Math.max(bottomInset, 12) }}>
      <View className={cn(
        "mx-auto w-full max-w-3xl flex-row items-end gap-1 rounded-[26px] border bg-raised/80 p-1.5",
        focused ? "border-accent-border" : "border-hairline",
      )}>
        <Pressable disabled className="h-11 w-11 shrink-0 items-center justify-center rounded-full opacity-40"
          accessibilityRole="button" accessibilityLabel="Attachments are not available yet" accessibilityState={{ disabled: true }}>
          <Plus size={20} color="#b8b8b8" />
        </Pressable>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={(value) => {
            setDraft(selectedId, value);
            if (!filePastePending.current) setAttachmentNotice(false);
            filePastePending.current = false;
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onContentSizeChange={Platform.OS === "web" ? undefined : (event) => setHeight(Math.max(44, event.nativeEvent.contentSize.height))}
          placeholder={busy ? `Reply to ${agentName}…` : `Message ${agentName}`}
          placeholderTextColor="#a3a3a3"
          accessibilityLabel={`Message ${agentName}`}
          accessibilityHint={offline ? "You can write a draft; sending is unavailable while offline." : hint}
          className="min-w-0 flex-1 rounded-xl px-1 py-3 text-[15px] leading-5 text-ink"
          style={{ height: Math.min(height, maxInputHeight), maxHeight: maxInputHeight, textAlignVertical: "top" }}
          maxLength={MAX_MESSAGE_LENGTH}
          multiline
          numberOfLines={1}
          submitBehavior="newline"
          onKeyPress={(event) => {
            if (Platform.OS !== "web") return;
            const nativeEvent = event.nativeEvent as { key?: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number };
            if (nativeEvent.isComposing || nativeEvent.keyCode === 229) return;
            if (nativeEvent.key === "Escape") {
              event.preventDefault();
              inputRef.current?.blur();
              return;
            }
            // Enter commits a CJK composition before it can submit a message.
            if (nativeEvent.key === "Enter" && !nativeEvent.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        {busy ? (
          <Pressable key="stop" ref={setActionRef} onPress={() => void interrupt()} disabled={offline || stopping}
            className="h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink active:opacity-80"
            accessibilityRole="button" accessibilityLabel={stopping ? "Stopping reply" : "Stop generating"}
            aria-busy={stopping} accessibilityState={{ disabled: offline || stopping, busy: stopping }}>
            {stopping ? <ActivityIndicator size="small" color="#070707" /> : <Square size={14} color="#070707" fill="#070707" />}
          </Pressable>
        ) : (
          <Pressable key="send" ref={setActionRef} onPress={() => void submit()} disabled={!canSend}
            className={cn("h-11 w-11 shrink-0 items-center justify-center rounded-full", canSend ? "bg-accent active:opacity-80" : "bg-raised-hover")}
            accessibilityRole="button" accessibilityLabel="Send message" aria-busy={sendingMessage} accessibilityState={{ disabled: !canSend, busy: sendingMessage }}>
            {sendingMessage ? <ActivityIndicator size="small" color="#a3a3a3" /> : <ArrowUp size={20} color={canSend ? "#fcfcfc" : "#a3a3a3"} />}
          </Pressable>
        )}
      </View>
      {windowHeight >= 400 || attachmentNotice ? <View className="mx-auto mt-2 w-full max-w-3xl flex-row items-start justify-between gap-2 px-2">
        <Text accessibilityLiveRegion={attachmentNotice ? "polite" : "none"}
          className={cn("min-w-0 flex-1 text-[11px] leading-4", attachmentNotice ? "text-warning" : "text-ink-secondary")}>{hint}</Text>
        {text.length > MAX_MESSAGE_LENGTH * 0.8 ? (
          <Text className={cn("shrink-0 text-[11px] leading-4", text.length === MAX_MESSAGE_LENGTH ? "text-warning" : "text-ink-secondary")}
            accessibilityLabel={`${text.length} of ${MAX_MESSAGE_LENGTH} characters`}>
            {text.length}/{MAX_MESSAGE_LENGTH}
          </Text>
        ) : null}
      </View> : null}
    </View>
  );
}
