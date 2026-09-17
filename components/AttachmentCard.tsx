import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import { Download, Paperclip } from "lucide-react-native";
import type { MessageAttachment } from "@/lib/types";
import { useStore } from "@/lib/store";
import { botFilePath, formatFileSize } from "@/lib/files";
import { blobDataUrl, saveDownload } from "@/lib/media";
import { attachmentLabel } from "@/lib/message-preview";
import { ExternalLink } from "./ExternalLink";

export function AttachmentCard({ file, agentId, onFocusLost }: { file: MessageAttachment; agentId: string; onFocusLost?: () => void }) {
  const { requestBinary, settings } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => { setPreview(null); setError(null); setBusy(false); return () => { pending.current?.abort(); }; }, [settings.profileId, agentId, file.id]);
  const load = async (download: boolean) => {
    if (busy || !file.id) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError(null);
    try {
      // Build the endpoint ourselves: never send a device credential to a URL in a message.
      const result = await requestBinary(botFilePath(agentId, file.id), { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (download) await saveDownload(result.blob, file.name ?? "attachment", file.mime ?? result.contentType);
      else {
        if (!/^image\/(png|jpe?g|gif|webp|avif|bmp)(?:;|$)/i.test(result.contentType)) throw new Error("Download this image to view its format.");
        const uri = await blobDataUrl(result.blob);
        if (!controller.signal.aborted) setPreview(uri);
      }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not download the file."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  if (!file.id) return <ExternalLink url={file.url} label={attachmentLabel(file)} buttonStyle="default" onFocusLost={onFocusLost}
    icon={<Paperclip size={15} color="#b3b3b3" />} />;
  return <View testID={`attachment-${file.id}`} className="min-w-0 max-w-full gap-2 rounded-xl border border-hairline bg-inset p-3">
    <View className="flex-row items-center gap-2"><Paperclip size={18} color="#b8b8b8" /><Text className="min-w-0 flex-1 text-[13px] font-semibold text-ink" numberOfLines={2}>{file.name ?? "Attachment"}</Text></View>
    <Text className="text-[11px] text-ink-secondary">{[file.size ? formatFileSize(file.size) : null, file.mime].filter(Boolean).join(" · ")}</Text>
    {preview ? <Image source={{ uri: preview }} style={{ width: 240, height: 180, maxWidth: "100%" }} resizeMode="contain" accessibilityLabel={file.name ?? "Attached image"} /> : null}
    <View className="flex-row flex-wrap gap-3">
      {file.type === "image" && !preview ? <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={`Preview ${file.name ?? "image"}`} onPress={() => void load(false)} className="min-h-11 justify-center"><Text className="text-[13px] text-accent">View image</Text></Pressable> : null}
      <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={`Download ${file.name ?? "attachment"}`} onPress={() => void load(true)} className="min-h-11 flex-row items-center gap-2">
        {busy ? <ActivityIndicator size="small" color="#1084fe" /> : <Download size={15} color="#1084fe" />}<Text className="text-[13px] text-accent">{busy ? "Loading…" : "Download"}</Text>
      </Pressable>
    </View>
    {error ? <Text accessibilityRole="alert" className="text-[12px] text-danger">{error}</Text> : null}
  </View>;
}
