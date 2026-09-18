import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View, Platform, useWindowDimensions } from "react-native";
import { ArrowUp, Plus, Square } from "lucide-react-native";
import { useStore } from "@/lib/store";
import { MAX_MESSAGE_LENGTH } from "@/lib/channel";
import { cn } from "@/lib/cn";
import { containsFiles, UPLOAD_NOTICE } from "@/lib/use-file-drop-guard";
import { useFocusOnRemoval } from "@/lib/use-focus-on-removal";
import { browserFiles, pickFiles } from "@/lib/file-picker";
import { AttachmentTray } from "./AttachmentTray";

export function Composer({ agentName, busy, deliveryPending = false, agentOffline = false, bottomInset = 0,
  attachmentNotice, setAttachmentNotice, onSubmit, pendingRequests = 0, onReviewRequest }: {
  agentName: string;
  busy: boolean;
  deliveryPending?: boolean;
  agentOffline?: boolean;
  bottomInset?: number;
  attachmentNotice: boolean;
  setAttachmentNotice: (visible: boolean) => void;
  onSubmit: () => void;
  pendingRequests?: number;
  onReviewRequest?: () => void;
}) {
  const { selectedId, agents, settings, draftsByAgent, setDraft, clearDraft, send, interrupt, interrupting, connection,
    attachmentsByAgent, addAttachments, clearAttachments, retryAttachment } = useStore();
  const text = draftsByAgent[selectedId] ?? "";
  const attachments = attachmentsByAgent[selectedId] ?? [];
  const filesAvailable = !settings.useMockChannel && !!agents.find((agent) => agent.id === selectedId)?.capabilities?.files;
  const { height: windowHeight } = useWindowDimensions();
  // Leave room for connection recovery controls in short windows. Longer
  // drafts scroll inside the input and expand again when more height returns.
  const maxInputHeight = windowHeight < 300 ? 44 : Math.max(44, Math.min(160, Math.floor(windowHeight * 0.25)));
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [height, setHeight] = useState(44);
  const [attachmentMenu, setAttachmentMenu] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const sending = useRef(false);
  const filePastePending = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const shellRef = useRef<View>(null);
  const actionRef = useRef<View | null>(null);
  const offline = connection !== "connected" || agentOffline;
  const stopping = !!interrupting[selectedId];
  const sendingMessage = submitting || deliveryPending;
  const canSend = (text.trim().length > 0 || attachments.length > 0) && attachments.every((row) => row.status === "ready") && !busy && !offline && !sendingMessage;
  useEffect(() => { setAttachmentMenu(false); setPickerError(null); }, [selectedId, settings.profileId]);
  const queueFiles = useCallback((files: File[]) => {
    try { addAttachments(selectedId, browserFiles(files)); setPickerError(null); setAttachmentNotice(false); }
    catch (error) { setPickerError(error instanceof Error ? error.message : "Could not attach these files."); }
  }, [addAttachments, selectedId, setAttachmentNotice]);
  const chooseFiles = async (images: boolean) => {
    if (picking) return;
    setPicking(true); setPickerError(null); setAttachmentMenu(false);
    try { addAttachments(selectedId, await pickFiles(images)); }
    catch (error) { setPickerError(error instanceof Error ? error.message : "Could not choose files."); }
    finally { setPicking(false); }
  };
  const focusDraft = useCallback(() => inputRef.current?.focus(), []);
  const setActionRecoveryRef = useFocusOnRemoval(focusDraft);
  const setActionRef = useCallback((node: View | null) => {
    setActionRecoveryRef(node);
    actionRef.current = node;
  }, [setActionRecoveryRef]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const input = inputRef.current as unknown as HTMLTextAreaElement | null;
    let pasteReset: ReturnType<typeof setTimeout> | undefined;
    const drop = (event: DragEvent) => {
      if (!containsFiles(event.dataTransfer)) return;
      setDragOver(false);
      if (filesAvailable && !offline) queueFiles(Array.from(event.dataTransfer?.files ?? []));
      else setAttachmentNotice(true);
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
      if (filesAvailable && !offline) queueFiles(Array.from(event.clipboardData?.files ?? []));
      else setAttachmentNotice(true);
    };
    const shell = shellRef.current as unknown as HTMLElement | null;
    const over = (event: DragEvent) => {
      if (!containsFiles(event.dataTransfer)) return;
      event.preventDefault();
      setDragOver(true);
    };
    const leave = (event: DragEvent) => {
      if (event.relatedTarget && shell?.contains(event.relatedTarget as Node)) return;
      setDragOver(false);
    };
    const dropOnShell = (event: DragEvent) => {
      if (!containsFiles(event.dataTransfer)) return;
      event.preventDefault();
      setDragOver(false);
    };
    window.addEventListener("drop", drop);
    input?.addEventListener("paste", paste);
    shell?.addEventListener("dragover", over);
    shell?.addEventListener("dragleave", leave);
    shell?.addEventListener("drop", dropOnShell);
    return () => {
      window.removeEventListener("drop", drop);
      input?.removeEventListener("paste", paste);
      shell?.removeEventListener("dragover", over);
      shell?.removeEventListener("dragleave", leave);
      shell?.removeEventListener("drop", dropOnShell);
      if (pasteReset) clearTimeout(pasteReset);
    };
  }, [setAttachmentNotice, queueFiles, filesAvailable, offline]);

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
    const submittedAttachments = attachments;
    sending.current = true;
    setSubmitting(true);
    onSubmit();
    try {
      const ok = await send(draft, agentId, submittedAttachments.map((row) => row.file!));
      if (ok) { clearDraft(agentId, draft); clearAttachments(agentId, submittedAttachments.map((row) => row.id)); setAttachmentNotice(false); }
    } finally {
      sending.current = false;
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };

  const hint = attachmentNotice ? UPLOAD_NOTICE : offline ? "Offline"
    : attachments.some((row) => row.status === "uploading") ? "Uploading…"
    : attachments.some((row) => row.status === "failed") ? "Upload failed"
    : stopping ? "Stopping…" : undefined;

  return (
    <View className="px-4 pt-2" style={{ paddingBottom: Math.max(bottomInset, 12) }}>
      {pendingRequests > 0 ? <Pressable onPress={onReviewRequest} accessibilityRole="button" accessibilityLabel="Review pending request"
        className="mx-auto mb-2 min-h-11 flex-row items-center gap-2 rounded-xl px-3 py-2">
        <Text className="text-[12px] text-ink-secondary">{pendingRequests === 1 ? "Reply needed" : `${pendingRequests} replies needed`}</Text>
      </Pressable> : null}
      {pickerError ? <Text accessibilityRole="alert" className="mx-auto mb-2 w-full max-w-3xl text-[12px] text-danger">{pickerError}</Text> : null}
      <View ref={shellRef}
        {...(Platform.OS === "web" ? {
          onMouseEnter: () => setHovered(true),
          onMouseLeave: () => setHovered(false),
          onMouseDown: (event: { target?: unknown; preventDefault?: () => void }) => {
            const target = event.target as HTMLElement | undefined;
            if (!target || target.closest("button, a, input, textarea, [role='button']")) return;
            event.preventDefault?.();
            inputRef.current?.focus();
          },
        } : {})}
        className={cn("mx-auto w-full max-w-3xl rounded-2xl border bg-panel p-2",
          dragOver ? "border-accent" : focused ? "border-accent-border" : hovered ? "border-hairline" : "border-hairline/70")}>
        <AttachmentTray rows={attachments} remove={(id) => clearAttachments(selectedId, [id])} retry={(id) => retryAttachment(selectedId, id)} />
        {attachmentMenu ? <View className="mb-1 flex-row flex-wrap gap-1">
          <Pressable accessibilityRole="button" accessibilityLabel="Choose photos" onPress={() => void chooseFiles(true)} className="min-h-11 justify-center rounded-lg px-3"><Text className="text-[13px] text-ink">Photos</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose files" onPress={() => void chooseFiles(false)} className="min-h-11 justify-center rounded-lg px-3"><Text className="text-[13px] text-ink">Files</Text></Pressable>
        </View> : null}
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
          onContentSizeChange={Platform.OS === "web" ? undefined : (event) => setHeight(Math.max(36, event.nativeEvent.contentSize.height))}
          placeholder={dragOver && filesAvailable ? "Drop files here to add to chat" : `Message ${agentName}`}
          placeholderTextColor="#a3a3a3"
          accessibilityLabel={`Message ${agentName}`}
          accessibilityHint={offline ? "You can write a draft; sending is unavailable while offline." : hint}
          className="min-w-0 px-2 py-2 text-[14px] leading-5 text-ink outline-none"
          style={{ height: Math.min(height, maxInputHeight), maxHeight: maxInputHeight, textAlignVertical: "top" }}
          maxLength={MAX_MESSAGE_LENGTH}
          multiline
          numberOfLines={1}
          submitBehavior="newline"
          onKeyPress={(event) => {
            if (Platform.OS !== "web") return;
            const nativeEvent = event.nativeEvent as { key?: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number; repeat?: boolean };
            if (nativeEvent.isComposing || nativeEvent.keyCode === 229) return;
            if (nativeEvent.key === "Escape") {
              event.preventDefault();
              inputRef.current?.blur();
              return;
            }
            // Enter commits a CJK composition before it can submit a message.
            if (nativeEvent.key === "Enter" && !nativeEvent.shiftKey) {
              event.preventDefault();
              // A held Enter may outlast a running turn or reconnect. Require
              // a fresh press before sending the draft when Send is enabled.
              if (!nativeEvent.repeat) void submit();
            }
          }}
        />
        <View className="flex-row items-center justify-between">
          <Pressable disabled={!filesAvailable || offline || picking} onPress={() => setAttachmentMenu((visible) => !visible)}
            className={cn("h-9 w-9 items-center justify-center rounded-lg", (!filesAvailable || offline) && "opacity-40")}
            accessibilityRole="button" accessibilityLabel={filesAvailable ? "Add attachments" : "File uploads unavailable for this bot"} accessibilityState={{ disabled: !filesAvailable || offline || picking }}>
            <Plus size={18} color={focused || hovered ? "#fcfcfc" : "#b8b8b8"} />
          </Pressable>
          {busy ? (
            <Pressable key="stop" ref={setActionRef} onPress={() => {
              // Disabling the pending Stop button blurs it before its eventual
              // removal. Preserve keyboard focus before requesting the interrupt.
              if (Platform.OS === "web" && document.activeElement === (actionRef.current as unknown as HTMLElement)) inputRef.current?.focus();
              void interrupt();
            }} disabled={offline || stopping}
              className="h-9 w-9 items-center justify-center rounded-lg bg-ink active:opacity-80"
              accessibilityRole="button" accessibilityLabel={stopping ? "Stopping reply" : "Stop generating"}
              aria-busy={stopping} accessibilityState={{ disabled: offline || stopping, busy: stopping }}>
              {stopping ? <ActivityIndicator size="small" color="#070707" /> : <Square size={12} color="#070707" fill="#070707" />}
            </Pressable>
          ) : (
            <Pressable key="send" ref={setActionRef} onPress={() => void submit()} disabled={!canSend}
              className={cn("h-9 w-9 items-center justify-center rounded-lg", canSend ? "bg-accent active:opacity-80" : "bg-raised")}
              accessibilityRole="button" accessibilityLabel="Send message" aria-busy={sendingMessage} accessibilityState={{ disabled: !canSend, busy: sendingMessage }}>
              {sendingMessage ? <ActivityIndicator size="small" color="#a3a3a3" /> : <ArrowUp size={18} color={canSend ? "#fcfcfc" : "#a3a3a3"} />}
            </Pressable>
          )}
        </View>
      </View>
      {windowHeight >= 400 && ((hint && (attachmentNotice || hint === "Upload failed")) || text.length > MAX_MESSAGE_LENGTH * 0.8) ? <View className="mx-auto mt-2 w-full max-w-3xl flex-row items-start justify-between gap-2 px-2">
        {hint && (attachmentNotice || hint === "Upload failed") ? <Text accessibilityLiveRegion={attachmentNotice ? "polite" : "none"}
          className={cn("min-w-0 flex-1 text-[11px] leading-4", attachmentNotice ? "text-warning" : "text-ink-secondary")}>{hint}</Text> : null}
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
