import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Paperclip, X } from "lucide-react-native";
import { formatFileSize, type DraftAttachment } from "@/lib/files";

export function AttachmentTray({ rows, remove, retry }: {
  rows: DraftAttachment[]; remove: (id: string) => void; retry: (id: string) => void;
}) {
  if (!rows.length) return null;
  return <View className="mx-auto mb-2 w-full max-w-3xl gap-2">
    {rows.map((row) => <View key={row.id} testID={`draft-attachment-${row.id}`} className="flex-row items-center gap-3 rounded-xl border border-hairline bg-panel p-3">
      {row.status === "uploading" ? <ActivityIndicator size="small" color="#1084fe" /> : <Paperclip size={18} color="#b8b8b8" />}
      <View className="min-w-0 flex-1"><Text className="text-[13px] font-semibold text-ink" numberOfLines={1}>{row.source.name}</Text>
        <Text className={row.status === "failed" ? "mt-1 text-[12px] text-danger" : "mt-1 text-[12px] text-ink-secondary"}>
          {row.status === "uploading" ? "Uploading…" : row.status === "failed" ? row.error : `${formatFileSize(row.source.size)} · Ready to send`}</Text></View>
      {row.status === "failed" ? <Pressable accessibilityRole="button" accessibilityLabel={`Retry upload ${row.source.name}`} onPress={() => retry(row.id)} className="min-h-11 justify-center px-2"><Text className="text-accent">Retry</Text></Pressable> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove attachment ${row.source.name}`} onPress={() => remove(row.id)} className="h-11 w-11 items-center justify-center"><X size={18} color="#b8b8b8" /></Pressable>
    </View>)}
  </View>;
}
