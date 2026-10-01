import { Clipboard, Platform } from "react-native";

export async function copyText(text: string): Promise<void> {
  if (Platform.OS === "web") {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (clipboard?.writeText) {
      try { await clipboard.writeText(text); return; } catch {}
    }
  }
  Clipboard.setString(text);
}
