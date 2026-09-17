import { useCallback, useRef } from "react";
import { Platform, type View } from "react-native";

/** Restore keyboard navigation only when a disappearing view contains focus. */
export function useFocusOnRemoval<T = View>(onFocusLost?: () => void) {
  const ref = useRef<T | null>(null);
  return useCallback((node: T | null) => {
    const previous = ref.current as unknown as HTMLElement | null;
    if (!node && Platform.OS === "web" && previous?.contains(document.activeElement)) {
      // Replacing a conversation removes its old focus target too. Wait until
      // React has attached the replacement refs, and respect any intervening
      // focus move (such as closing the drawer or selecting an unread row).
      queueMicrotask(() => {
        if (!previous.isConnected && (!document.activeElement || document.activeElement === document.body)) onFocusLost?.();
      });
    }
    ref.current = node;
  }, [onFocusLost]);
}
