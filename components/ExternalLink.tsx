import { useState } from "react";
import { Linking, Platform, Text } from "react-native";
import { normalizeHttpUrl } from "@/lib/channel/protocol";

/** Real anchors on web; native links report failures inline instead of rejecting silently. */
export function ExternalLink({ url, label }: { url: string; label: string }) {
  const [failed, setFailed] = useState(false);
  const href = normalizeHttpUrl(url);
  if (!href) return <Text>{label}</Text>;
  const open = async () => {
    setFailed(false);
    try { await Linking.openURL(href); } catch { setFailed(true); }
  };
  return (
    <Text accessibilityRole="link" accessibilityLabel={`${label}, opens in browser`}
      className="text-[14px] leading-6 text-accent-border underline"
      {...(Platform.OS === "web" ? { href, hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } } : { onPress: () => void open() })}>
      {label}{failed ? " (could not open link)" : ""}
    </Text>
  );
}
