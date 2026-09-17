import { useCallback, useRef } from "react";
import { Platform, type View } from "react-native";

/** Restore navigation when the focused control disappears or becomes disabled. */
export function useFocusOnRemoval<T = View>(onFocusLost?: () => void) {
  const ref = useRef<T | null>(null);
  const removeFocusListener = useRef<(() => void) | null>(null);
  return useCallback((node: T | null) => {
    const previous = ref.current as unknown as HTMLElement | null;
    removeFocusListener.current?.();
    removeFocusListener.current = null;
    const recover = (focused: Element) => {
      // Replacing a conversation removes its old focus target too. Wait until
      // React has attached the replacement refs, and respect any intervening
      // focus move (such as closing the drawer or selecting an unread row).
      queueMicrotask(() => {
        if ((!focused.isConnected || focused.matches(':disabled, [aria-disabled="true"]')) &&
          (!document.activeElement || document.activeElement === document.body)) onFocusLost?.();
      });
    };
    if (Platform.OS === "web") {
      const focused = document.activeElement;
      if (!node && focused && previous?.contains(focused)) recover(focused);
      const element = node as unknown as HTMLElement | null;
      if (element && onFocusLost) {
        // Disabling a mounted button can blur it after refs and microtasks
        // have run. Observe the actual blur, including from child controls.
        const focusOut = (event: FocusEvent) => {
          if (event.target instanceof Element) recover(event.target);
        };
        element.addEventListener("focusout", focusOut);
        removeFocusListener.current = () => element.removeEventListener("focusout", focusOut);
      }
    }
    ref.current = node;
  }, [onFocusLost]);
}
