import { useCallback, useRef, type RefObject } from "react";
import { Platform, type ScrollView, type View } from "react-native";
import { useFocusEffect } from "expo-router";

/** Keep keyboard navigation in the active web screen across route changes. */
export function useScreenFocus(
  rootRef: RefObject<View | ScrollView | null>,
  fallback: () => HTMLElement | null | undefined,
  enabled = true,
) {
  const lastFocused = useRef<HTMLElement | null>(null);
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== "web" || !enabled) return;
    const screen = () => {
      const root = rootRef.current;
      return (root && "getScrollableNode" in root ? root.getScrollableNode() : root) as HTMLElement | null;
    };
    const visible = (element: HTMLElement | null): element is HTMLElement => !!element?.isConnected &&
      element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"], [inert]') &&
      !element.matches(':disabled, [aria-disabled="true"]');
    const rememberFocus = () => {
      const element = document.activeElement;
      if (element instanceof HTMLElement && screen()?.contains(element)) lastFocused.current = element;
    };
    document.addEventListener("focusin", rememberFocus);
    // Screens can become focused before navigation commits their visible DOM.
    // Retain the last local target even if hiding the old route already blurred it.
    const frame = requestAnimationFrame(() => {
      const root = screen();
      if (!visible(root)) return;
      const active = document.activeElement;
      // Respect a control the user (or a drawer) focused during navigation.
      if (active instanceof HTMLElement && active !== document.body && visible(active)) return;
      const previous = lastFocused.current;
      const target = visible(previous) && root.contains(previous) ? previous : fallback();
      target?.focus({ preventScroll: true });
    });
    rememberFocus();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", rememberFocus);
    };
  }, [rootRef, fallback, enabled]));
}
