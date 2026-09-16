import { useState } from "react";
import { Linking, Platform, Text } from "react-native";
import { isHttpUrl } from "@/lib/channel/protocol";

/** Real anchors on web; native links report failures inline instead of rejecting silently. */
export function ExternalLink({ url, label }: { url: string; label: string }) {
  const [failed, setFailed] = useState(false);
  if (!isHttpUrl(url)) return <Text>{label}</Text>;
  const open = async () => {
    setFailed(false);
    try { await Linking.openURL(url); } catch { setFailed(true); }
  };
  return (
    <Text accessibilityRole="link" accessibilityLabel={`${label}, opens in browser`}
      className="text-[14px] leading-6 text-accent-border underline"
      {...(Platform.OS === "web" ? { href: url, hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } } : { onPress: () => void open() })}>
      {label}{failed ? " (could not open link)" : ""}
    </Text>
  );
}
