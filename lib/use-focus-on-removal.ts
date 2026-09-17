import { useCallback, useRef } from "react";
import { Platform, type View } from "react-native";

/** Restore keyboard navigation only when a disappearing view contains focus. */
export function useFocusOnRemoval(onFocusLost: () => void) {
  const ref = useRef<View | null>(null);
  return useCallback((node: View | null) => {
    if (!node && Platform.OS === "web" &&
      (ref.current as unknown as HTMLElement | null)?.contains(document.activeElement)) onFocusLost();
    ref.current = node;
  }, [onFocusLost]);
}
