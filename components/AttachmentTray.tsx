import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, Text, View } from "react-native";
import { FileText, X } from "lucide-react-native";
import { formatFileSize, type DraftAttachment } from "@/lib/files";
import { cn } from "@/lib/cn";

const TILE = 80;

/** Fluid Functionalism FileThumbnail tiles for the composer. */
export function AttachmentTray({ rows, remove, retry }: {
  rows: DraftAttachment[]; remove: (id: string) => void; retry: (id: string) => void;
}) {
  if (!rows.length) return null;
  return <View className="flex-row flex-wrap gap-2 pb-1">
    {rows.map((row) => <Tile key={row.id} row={row} remove={() => remove(row.id)} retry={() => retry(row.id)} />)}
  </View>;
}

function Tile({ row, remove, retry }: { row: DraftAttachment; remove: () => void; retry: () => void }) {
  const preview = usePreviewUri(row);
  const caption = row.status === "uploading" ? "Uploading…" : row.status === "failed" ? row.error : `${formatFileSize(row.source.size)} · Ready to send`;
  return <View testID={`draft-attachment-${row.id}`} className="w-20">
    <View className="relative overflow-hidden rounded-xl border border-hairline bg-inset" style={{ width: TILE, height: TILE }}>
      {preview ? <Image source={{ uri: preview }} style={{ width: TILE, height: TILE }} resizeMode="cover" accessibilityLabel={row.source.name} />
        : <View className="flex-1 items-center justify-center" accessibilityLabel={row.source.name}>
          {row.status === "uploading" ? <ActivityIndicator size="small" color="#b3b3b3" /> : <FileText size={28} color="#b3b3b3" />}
        </View>}
      {row.status === "uploading" && preview ? <View className="absolute inset-0 items-center justify-center bg-black/40"><ActivityIndicator size="small" color="#fcfcfc" /></View> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove attachment ${row.source.name}`} onPress={remove}
        className="absolute right-0 top-0 h-11 w-11 items-end justify-start p-1">
        <View className="h-5 w-5 items-center justify-center rounded-full bg-black"><X size={12} color="#fcfcfc" strokeWidth={2.5} /></View>
      </Pressable>
    </View>
    <Text className={cn("mt-1 text-[11px] leading-4", row.status === "failed" ? "text-danger" : "text-ink-secondary")} numberOfLines={2}>{caption}</Text>
    {row.status === "failed" ? <Pressable accessibilityRole="button" accessibilityLabel={`Retry upload ${row.source.name}`} onPress={retry} className="min-h-11 justify-center">
      <Text className="text-[12px] text-accent">Retry</Text>
    </Pressable> : null}
  </View>;
}

function usePreviewUri(row: DraftAttachment): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const image = row.source.mime.startsWith("image/");
  useEffect(() => {
    if (!image) { setUrl(null); return; }
    if (row.source.file && Platform.OS === "web") {
      const next = URL.createObjectURL(row.source.file);
      setUrl(next);
      return () => URL.revokeObjectURL(next);
    }
    if (row.source.uri && !row.source.uri.startsWith("browser:")) { setUrl(row.source.uri); return; }
    setUrl(null);
  }, [image, row.source.file, row.source.uri]);
  return url;
}
