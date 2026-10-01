import { View, Text, Image } from "react-native";
import Svg, { Circle, Path, Polygon, Rect } from "react-native-svg";
import { cn } from "@/lib/cn";
import { avatarShapeId } from "@/lib/avatar";

type Props = {
  color: string;
  name: string;
  size?: number;
  shape?: string | null;
  url?: string | null;
};

/** Fraction of the box used as the image's corner radius for each silhouette. */
const IMAGE_RADIUS: Record<string, number> = {
  circle: 0.5, squircle: 0.34, rounded: 0.22, square: 0.08,
  hexagon: 0.28, diamond: 0.24, blob: 0.3, drop: 0.3,
};

function Silhouette({ shape, color }: { shape: string; color: string }) {
  const fill = { fill: color };
  switch (shape) {
    case "squircle": return <Rect x={0} y={0} width={100} height={100} rx={34} {...fill} />;
    case "rounded": return <Rect x={0} y={0} width={100} height={100} rx={22} {...fill} />;
    case "square": return <Rect x={0} y={0} width={100} height={100} rx={6} {...fill} />;
    case "hexagon": return <Polygon points="50,2 94,26 94,74 50,98 6,74 6,26" {...fill} />;
    case "diamond": return <Polygon points="50,2 98,50 50,98 2,50" {...fill} />;
    case "blob": return <Path d="M50 4C78 4 96 22 96 46C96 72 78 96 52 96C28 96 4 76 4 52C4 28 26 4 50 4Z" {...fill} />;
    case "drop": return <Path d="M50 2C50 2 96 42 96 64C96 85 75 98 50 98C25 98 4 85 4 64C4 42 50 2 50 2Z" {...fill} />;
    default: return <Circle cx={50} cy={50} r={50} {...fill} />;
  }
}

/** Avatar: an image when set, otherwise a shaped color swatch behind the agent's initial. */
export function BlobAvatar({ color, name, size = 40, shape, url }: Props) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const shapeId = avatarShapeId(shape);
  if (url) {
    return (
      <View
        accessible={false}
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: size, height: size }}
      >
        <Image source={{ uri: url }} resizeMode="cover"
          style={{ width: size, height: size, backgroundColor: color, borderRadius: size * (IMAGE_RADIUS[shapeId] ?? 0.5) }} />
      </View>
    );
  }
  return (
    <View
      accessible={false}
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn("items-center justify-center")}
      style={{ width: size, height: size, opacity: 0.95 }}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: "absolute" }}>
        <Silhouette shape={shapeId} color={color} />
      </Svg>
      <Text
        className="font-semibold text-ink"
        style={{ fontSize: Math.max(12, size * 0.4) }}
      >
        {initial}
      </Text>
    </View>
  );
}
