import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, PanResponder, Platform, Pressable, Text, View, useColorScheme, useWindowDimensions } from "react-native";
import type { GestureResponderEvent } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import Svg, { Line } from "react-native-svg";
import { useStore } from "@/lib/store";
import { BlobAvatar } from "@/components/BlobAvatar";
import { cn } from "@/lib/cn";
import { graphPath, layoutGraph, parseGraph, NODE_HEIGHT, NODE_WIDTH, type OrgGraph, type OrgNode } from "@/lib/org-graph";
import { resolveTheme, themeColors } from "@/lib/theme";

const MIN_SCALE = 1;
const MAX_SCALE = 3;
const CIRCLE = "h-11 w-11 items-center justify-center rounded-full bg-raised active:bg-raised-hover";
const SMALL = "h-9 w-9 items-center justify-center rounded-full active:bg-raised-hover";
const ICON = "#d4d4d4";
const FALLBACK_AVATAR = "#4a4a4a";

function touchDistance(touches: ReadonlyArray<{ pageX: number; pageY: number }>): number {
  const [first, second] = touches;
  if (!first || !second) return 0;
  return Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
}

export default function OrgChartScreen() {
  const { agents, request, selectAgent, settings } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < 768;
  const systemScheme = useColorScheme();
  const scheme = resolveTheme(settings.theme, systemScheme);
  const colors = themeColors(scheme);
  const spaceId = settings.spaceId;
  const [graph, setGraph] = useState<OrgGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<OrgNode | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const close = useCallback(() => { if (router.canGoBack()) router.back(); else router.replace("/"); }, [router]);

  const load = useCallback(() => {
    if (!spaceId) { setGraph({ nodes: [], edges: [] }); setError(null); setLoading(false); return; }
    setLoading(true); setError(null);
    void request<unknown>(graphPath(spaceId))
      .then((value) => setGraph(parseGraph(value)))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load the org chart."))
      .finally(() => setLoading(false));
  }, [request, spaceId]);

  useEffect(() => { load(); }, [load]);

  const layout = useMemo(() => (graph ? layoutGraph(graph) : null), [graph]);
  const colorFor = useCallback((id: string) => agents.find((agent) => agent.id === id)?.color ?? FALLBACK_AVATAR, [agents]);

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const bounds = useRef({ width: 0, height: 0 });
  const content = useRef({ width: 0, height: 0 });
  bounds.current = viewport;
  if (layout) content.current = { width: layout.width, height: layout.height };
  const gesture = useRef({ scale: 1, x: 0, y: 0, distance: 0, baseScale: 1,
    startX: 0, startY: 0, originX: 0, originY: 0 }).current;

  const clamp = useCallback(() => {
    const maxX = Math.max(0, (content.current.width * gesture.scale - bounds.current.width) / 2);
    const maxY = Math.max(0, (content.current.height * gesture.scale - bounds.current.height) / 2);
    gesture.x = Math.min(maxX, Math.max(-maxX, gesture.x));
    gesture.y = Math.min(maxY, Math.max(-maxY, gesture.y));
    translateX.setValue(gesture.x); translateY.setValue(gesture.y);
  }, [gesture, translateX, translateY]);

  const shouldCapture = useCallback((event: GestureResponderEvent) =>
    event.nativeEvent.touches.length >= 2, []);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponder: (_event, state) => Math.abs(state.dx) > 4 || Math.abs(state.dy) > 4,
    onMoveShouldSetPanResponderCapture: (event, state) => shouldCapture(event) || Math.abs(state.dx) > 4 || Math.abs(state.dy) > 4,
    onPanResponderGrant: (event) => {
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) { gesture.distance = touchDistance(touches); gesture.baseScale = gesture.scale; }
      else {
        gesture.startX = gesture.x; gesture.startY = gesture.y;
        gesture.originX = touches[0]?.pageX ?? 0; gesture.originY = touches[0]?.pageY ?? 0;
      }
    },
    onPanResponderMove: (event) => {
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) {
        const distance = touchDistance(touches);
        if (!gesture.distance) { gesture.distance = distance; gesture.baseScale = gesture.scale; return; }
        gesture.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (gesture.baseScale * distance) / gesture.distance));
        scale.setValue(gesture.scale); clamp(); return;
      }
      if (touches.length === 1) {
        gesture.x = gesture.startX + (touches[0]!.pageX - gesture.originX);
        gesture.y = gesture.startY + (touches[0]!.pageY - gesture.originY);
        clamp();
      }
    },
    onPanResponderRelease: () => {
      gesture.distance = 0;
      if (gesture.scale < 1.02) { gesture.scale = 1; scale.setValue(1); clamp(); }
    },
    onPanResponderTerminate: () => { gesture.distance = 0; },
    onPanResponderTerminationRequest: () => true,
  }), [clamp, gesture, scale, shouldCapture]);

  const containerRef = useRef<View | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = containerRef.current as unknown as HTMLElement | null;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      gesture.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, gesture.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
      if (gesture.scale === 1) { gesture.x = 0; gesture.y = 0; }
      scale.setValue(gesture.scale); clamp();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    node?.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    return () => { node?.removeEventListener("wheel", onWheel); window.removeEventListener("keydown", onKeyDown); };
  }, [clamp, gesture, scale]);

  function openChat(node: OrgNode) {
    selectAgent(node.id);
    router.dismissTo("/");
  }

  const empty = !loading && !error && graph !== null && graph.nodes.length === 0;

  return (
    <View className="flex-1 bg-app" style={{ paddingTop: Math.max(insets.top, 12) }}>
      <View className="flex-row items-center justify-between px-4 pb-3">
        <Pressable accessibilityRole="button" accessibilityLabel="Close org chart" onPress={close} className={CIRCLE}><X size={20} color={ICON} /></Pressable>
        <Text accessibilityRole="header" className="text-[13px] text-ink-secondary" numberOfLines={1}>{settings.spaceName ? `Org chart · ${settings.spaceName}` : "Org chart"}</Text>
        <View style={{ width: 44 }} />
      </View>
      <View className="flex-1 flex-row">
        {loading ? <View className="flex-1 items-center justify-center"><ActivityIndicator size="small" color="#b3b3b3" /></View>
          : error ? <View className="flex-1 items-center justify-center px-6">
            <Text accessibilityRole="alert" className="text-center text-[15px] leading-6 text-ink">{error}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Retry loading org chart" onPress={load} className="mt-4 min-h-11 items-center justify-center rounded-full bg-raised px-5 active:bg-raised-hover"><Text className="text-[15px] text-ink">Try again</Text></Pressable>
          </View>
          : empty ? <View className="flex-1 items-center justify-center px-6">
            <Text className="text-center text-[15px] leading-6 text-ink-secondary">No agents in this space yet.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={close} className="mt-4 min-h-11 items-center justify-center rounded-full bg-raised px-5 active:bg-raised-hover"><Text className="text-[15px] text-ink">Go back</Text></Pressable>
          </View>
          : <View ref={containerRef} className="flex-1 overflow-hidden"
            onLayout={(event) => setViewport({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}
            {...panResponder.panHandlers}>
            <View className="flex-1 items-center justify-center">
              {layout && graph ? <Animated.View style={{ width: layout.width, height: layout.height, transform: [{ translateX }, { translateY }, { scale }] }}>
                <Svg width={layout.width} height={layout.height} style={{ position: "absolute", left: 0, top: 0 }}>
                  {graph.edges.map((edge, index) => {
                    const from = layout.positions[edge.a], to = layout.positions[edge.b];
                    if (!from || !to) return null;
                    const strong = edge.type === "message";
                    return <Line key={`${edge.type}-${edge.a}-${edge.b}-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                      stroke={strong ? colors.ink : colors.hairline} strokeWidth={strong ? 1.25 : 1} />;
                  })}
                </Svg>
                {graph.nodes.map((node) => {
                  const point = layout.positions[node.id];
                  if (!point) return null;
                  const active = selected?.id === node.id;
                  return <Pressable key={node.id} accessibilityRole="button" accessibilityLabel={`${node.name}, ${node.status === "running" ? "running" : "stopped"}`}
                    onPress={() => setSelected(node)}
                    style={{ position: "absolute", left: point.x - NODE_WIDTH / 2, top: point.y - NODE_HEIGHT / 2, width: NODE_WIDTH }}
                    className={cn("items-center rounded-2xl border bg-panel px-2 py-1.5", active ? "border-ink-secondary" : "border-hairline")}>
                    <View className="flex-row items-center gap-1.5">
                      <BlobAvatar name={node.name} color={colorFor(node.id)} size={22} />
                      <View className={cn("h-1.5 w-1.5 rounded-full", node.status === "running" ? "bg-success" : "bg-ink-secondary")} />
                    </View>
                    <Text className="mt-1 w-full text-center text-[11px] text-ink" numberOfLines={1}>{node.name}</Text>
                  </Pressable>;
                })}
              </Animated.View> : null}
            </View>
          </View>}
        {selected ? <View className={cn("border-l border-hairline bg-panel", compact ? "absolute inset-y-0 right-0 w-[280px] max-w-[85%]" : "w-[300px]")}>
          <View className="flex-1">
            <View className="flex-row items-center justify-between px-4 pt-4">
              <Text className="min-w-0 flex-1 text-[15px] text-ink" numberOfLines={1}>{selected.name}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close inspector" onPress={() => setSelected(null)} className={SMALL}><X size={18} color={ICON} /></Pressable>
            </View>
            <View className="px-4 pt-3">
              <View className="flex-row items-center gap-2">
                <View className={cn("h-1.5 w-1.5 rounded-full", selected.status === "running" ? "bg-success" : "bg-ink-secondary")} />
                <Text className="text-[13px] text-ink-secondary">{selected.status === "running" ? "Running" : "Stopped"}</Text>
              </View>
              <Text className="pt-4 text-[14px] leading-5 text-ink">{selected.description || "No description."}</Text>
            </View>
          </View>
          <View className="p-4">
            <Pressable accessibilityRole="button" accessibilityLabel={`Open chat with ${selected.name}`} onPress={() => openChat(selected)}
              className="min-h-11 items-center justify-center rounded-full bg-ink py-3 active:opacity-80">
              <Text className="text-[15px] font-semibold text-app">Open chat</Text>
            </Pressable>
          </View>
        </View> : null}
      </View>
    </View>
  );
}
