import { useCallback, useEffect, useMemo, useRef } from "react";
import { Animated, Image, Modal, PanResponder, Platform, Pressable, View, useWindowDimensions } from "react-native";
import { X } from "lucide-react-native";
import { useReducedMotion } from "@/lib/use-reduced-motion";

const MAX_SCALE = 5;

function touchDistance(touches: ReadonlyArray<{ pageX: number; pageY: number }>): number {
  const [first, second] = touches;
  if (!first || !second) return 0;
  return Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
}

export function MediaViewer({ visible, uri, alt, onClose }: {
  visible: boolean; uri: string | null; alt?: string; onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const container = useRef<View | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const bounds = useRef({ width, height });
  bounds.current = { width, height };
  const gesture = useRef({ scale: 1, x: 0, y: 0, distance: 0, baseScale: 1,
    startX: 0, startY: 0, originX: 0, originY: 0, moved: false, lastTap: 0 }).current;

  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);

  const apply = useCallback((nextScale: number, x = 0, y = 0) => {
    gesture.scale = nextScale; gesture.x = x; gesture.y = y;
    if (reduced) {
      scale.setValue(nextScale); translateX.setValue(x); translateY.setValue(y);
      return;
    }
    Animated.parallel([
      Animated.spring(scale, { toValue: nextScale, useNativeDriver: false, bounciness: 0 }),
      Animated.spring(translateX, { toValue: x, useNativeDriver: false, bounciness: 0 }),
      Animated.spring(translateY, { toValue: y, useNativeDriver: false, bounciness: 0 }),
    ]).start();
  }, [gesture, reduced, scale, translateX, translateY]);

  const clampTranslation = useCallback(() => {
    const maxX = Math.max(0, (bounds.current.width * (gesture.scale - 1)) / 2);
    const maxY = Math.max(0, (bounds.current.height * (gesture.scale - 1)) / 2);
    gesture.x = Math.min(maxX, Math.max(-maxX, gesture.x));
    gesture.y = Math.min(maxY, Math.max(-maxY, gesture.y));
    translateX.setValue(gesture.x); translateY.setValue(gesture.y);
  }, [gesture, translateX, translateY]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      cancelClose();
      gesture.moved = false;
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) {
        gesture.distance = touchDistance(touches);
        gesture.baseScale = gesture.scale;
      } else {
        gesture.startX = gesture.x; gesture.startY = gesture.y;
        gesture.originX = touches[0]?.pageX ?? 0; gesture.originY = touches[0]?.pageY ?? 0;
      }
    },
    onPanResponderMove: (event) => {
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) {
        const distance = touchDistance(touches);
        if (!gesture.distance) { gesture.distance = distance; gesture.baseScale = gesture.scale; return; }
        gesture.moved = true;
        gesture.scale = Math.min(MAX_SCALE, Math.max(1, (gesture.baseScale * distance) / gesture.distance));
        scale.setValue(gesture.scale);
        clampTranslation();
        return;
      }
      if (touches.length === 1 && gesture.scale > 1) {
        const x = touches[0].pageX - gesture.originX;
        const y = touches[0].pageY - gesture.originY;
        if (Math.abs(x) > 4 || Math.abs(y) > 4) gesture.moved = true;
        const maxX = Math.max(0, (bounds.current.width * (gesture.scale - 1)) / 2);
        const maxY = Math.max(0, (bounds.current.height * (gesture.scale - 1)) / 2);
        gesture.x = Math.min(maxX, Math.max(-maxX, gesture.startX + x));
        gesture.y = Math.min(maxY, Math.max(-maxY, gesture.startY + y));
        translateX.setValue(gesture.x); translateY.setValue(gesture.y);
      }
    },
    onPanResponderRelease: () => {
      gesture.distance = 0;
      if (gesture.moved) { if (gesture.scale < 1.05) apply(1); return; }
      const now = Date.now();
      if (now - gesture.lastTap < 300) {
        cancelClose();
        apply(gesture.scale > 1.1 ? 1 : 2);
        gesture.lastTap = 0;
        return;
      }
      gesture.lastTap = now;
      if (gesture.scale > 1.05) { apply(1); return; }
      closeTimer.current = setTimeout(() => { closeTimer.current = null; onClose(); }, 300);
    },
    onPanResponderTerminationRequest: () => true,
    onPanResponderTerminate: () => { gesture.distance = 0; },
  }), [apply, cancelClose, clampTranslation, gesture, onClose, scale, translateX, translateY]);

  useEffect(() => {
    if (!visible) return;
    gesture.scale = 1; gesture.x = 0; gesture.y = 0; gesture.distance = 0;
    gesture.moved = false; gesture.lastTap = 0;
    scale.setValue(1); translateX.setValue(0); translateY.setValue(0);
  }, [visible, uri, gesture, scale, translateX, translateY]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  useEffect(() => {
    if (Platform.OS !== "web" || !visible) return;
    const node = container.current as unknown as HTMLElement | null;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      gesture.scale = Math.min(MAX_SCALE, Math.max(1, gesture.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
      if (gesture.scale === 1) { gesture.x = 0; gesture.y = 0; translateX.setValue(0); translateY.setValue(0); }
      scale.setValue(gesture.scale);
      clampTranslation();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    node?.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      node?.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [visible, onClose, clampTranslation, gesture, scale, translateX, translateY]);

  return (
    <Modal visible={visible && !!uri} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View ref={container} className="flex-1 items-center justify-center bg-black/95" accessibilityViewIsModal>
        <Animated.View className="absolute inset-0 items-center justify-center" {...panResponder.panHandlers}
          style={{ transform: [{ translateX }, { translateY }, { scale }] }}>
          <Image source={{ uri: uri ?? undefined }} style={{ width, height }} resizeMode="contain" accessibilityLabel={alt ?? "Image"} />
        </Animated.View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close image"
          className="absolute right-4 top-4 h-10 w-10 items-center justify-center rounded-full bg-raised active:bg-raised-hover">
          <X size={20} color="#fcfcfc" />
        </Pressable>
      </View>
    </Modal>
  );
}
