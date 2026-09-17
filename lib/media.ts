import { Platform } from "react-native";

export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the downloaded file."));
    reader.readAsDataURL(blob);
  });
}

export async function saveDownload(blob: Blob, name: string, mime?: string): Promise<void> {
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  const fs = await import("expo-file-system/legacy");
  const sharing = await import("expo-sharing");
  if (!await sharing.isAvailableAsync()) throw new Error("File sharing is unavailable on this device.");
  const directory = `${fs.cacheDirectory}zakura-download-${Date.now()}/`;
  const uri = `${directory}${name.replace(/[\/\\\u0000-\u001f]/g, "_")}`;
  await fs.makeDirectoryAsync(directory, { intermediates: true });
  try {
    const data = await blobDataUrl(blob);
    await fs.writeAsStringAsync(uri, data.slice(data.indexOf(",") + 1), { encoding: fs.EncodingType.Base64 });
    await sharing.shareAsync(uri, { mimeType: mime, dialogTitle: name });
  } finally { await fs.deleteAsync(directory, { idempotent: true }).catch(() => undefined); }
}
