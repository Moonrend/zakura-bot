import { useEffect } from "react";
import { Platform } from "react-native";

export const UPLOAD_NOTICE = "File uploads aren’t available yet. Paste text or a link instead.";

export function containsFiles(data: DataTransfer | null): boolean {
  return !!data && (Array.from(data.types).includes("Files") ||
    Array.from(data.items).some((item) => item.kind === "file"));
}

/** File drops must not replace the app, including routes without a composer. */
export function useFileDropGuard() {
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const preventNavigation = (event: DragEvent) => {
      if (!containsFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", preventNavigation, true);
    window.addEventListener("drop", preventNavigation, true);
    return () => {
      window.removeEventListener("dragover", preventNavigation, true);
      window.removeEventListener("drop", preventNavigation, true);
    };
  }, []);
}
