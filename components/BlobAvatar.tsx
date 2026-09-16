import { View, Text } from "react-native";
import { cn } from "@/lib/cn";

type Props = {
  color: string;
  name: string;
  size?: number;
};

/** Soft blob-style avatar (Grok Bot–inspired, clean rebuild). */
export function BlobAvatar({ color, name, size = 40 }: Props) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <View
      className={cn("items-center justify-center rounded-full")}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        opacity: 0.95,
      }}
    >
      <Text
        className="font-semibold text-ink"
        style={{ fontSize: Math.max(12, size * 0.4) }}
      >
        {initial}
      </Text>
    </View>
  );
}
