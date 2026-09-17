import { Platform } from "react-native";
import type { PickedFile } from "./files";

export const browserFiles = (files: File[]): PickedFile[] => files.map((file) => ({
  uri: `browser:${file.name}`, name: file.name, mime: file.type || "application/octet-stream", size: file.size, file,
}));

export async function pickFiles(images: boolean): Promise<PickedFile[]> {
  if (images && Platform.OS !== "web") {
    const picker = await import("expo-image-picker");
    const result = await picker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 8, quality: 1 });
    if (result.canceled) return [];
    const { File } = await import("expo-file-system");
    return result.assets.map((asset) => ({ uri: asset.uri, name: asset.fileName ?? `photo-${asset.assetId ?? Date.now()}.jpg`,
      mime: asset.mimeType ?? "image/jpeg", size: asset.fileSize ?? new File(asset.uri).size }));
  }
  const picker = await import("expo-document-picker");
  const result = await picker.getDocumentAsync({ type: images ? "image/*" : "*/*", multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return [];
  if (Platform.OS === "web") return result.assets.map((asset) => ({ uri: asset.uri, name: asset.name,
    mime: asset.mimeType ?? asset.file?.type ?? "application/octet-stream", size: asset.size ?? asset.file?.size ?? 0, file: asset.file }));
  const { File } = await import("expo-file-system");
  return result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, mime: asset.mimeType ?? "application/octet-stream",
    size: asset.size ?? new File(asset.uri).size }));
}
