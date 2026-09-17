import { useState, type ReactNode } from "react";
import { Linking, Platform, Pressable, Text, type View } from "react-native";
import { normalizeHttpUrl } from "@/lib/channel/protocol";
import { cn } from "@/lib/cn";
import type { MessageLink } from "@/lib/types";
import { useFocusOnRemoval } from "@/lib/use-focus-on-removal";

/** Real anchors on web; native links report failures inline instead of rejecting silently. */
export function ExternalLink({ url, label, buttonStyle, icon, onFocusLost }: {
  url: string; label: string; buttonStyle?: MessageLink["style"]; icon?: ReactNode; onFocusLost?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const setRef = useFocusOnRemoval<View | Text>(onFocusLost);
  const href = normalizeHttpUrl(url);
  if (!href) return <Text>{label}</Text>;
  const open = async () => {
    setFailed(false);
    try { await Linking.openURL(href); } catch { setFailed(true); }
  };
  const linkProps = {
    accessibilityRole: "link" as const,
    accessibilityLabel: `${label}, opens in browser`,
    ...(Platform.OS === "web" ? { href, hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } } : { onPress: () => void open() }),
  };
  const content = <>{label}{failed ? " (could not open link)" : ""}</>;
  // Replacing a destination must release focus and any held press on the old
  // anchor, including inline links whose surrounding spans reuse their keys.
  const identity = JSON.stringify([href, label]);
  if (buttonStyle) return (
    <Pressable key={identity} ref={setRef} {...linkProps} className={cn("min-h-11 max-w-full flex-row items-center gap-2 rounded-xl border px-3 py-2",
      buttonStyle === "primary" ? "border-accent bg-accent" : buttonStyle === "danger" ? "border-danger/50 bg-danger/10" : "border-hairline")}>
      {icon}
      <Text className={cn("min-w-0 flex-1 text-[14px] leading-6",
        buttonStyle === "primary" ? "font-semibold text-app" : buttonStyle === "danger" ? "text-ink" : "text-accent-border")}>{content}</Text>
    </Pressable>
  );
  return (
    <Text key={identity} ref={setRef} {...linkProps} className="text-[14px] leading-6 text-accent-border underline">
      {content}
    </Text>
  );
}
