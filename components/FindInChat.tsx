import { useEffect } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react-native";
import { cn } from "@/lib/cn";

const ICON = "#8a8a8a";
const BUTTON = "h-9 w-9 items-center justify-center rounded-full active:bg-raised/40";

type Props = {
  query: string;
  onQueryChange: (value: string) => void;
  matchCount: number;
  currentMatch: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
};

export function FindInChat({ query, onQueryChange, matchCount, currentMatch, onPrev, onNext, onClose }: Props) {
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const counter = query ? matchCount > 0 ? `${currentMatch + 1}/${matchCount}` : "No matches" : "";
  const disabled = matchCount === 0;
  return (
    <View className="flex-row items-center gap-1 border-b border-hairline bg-panel px-3 py-2">
      <Search size={16} color={ICON} />
      <TextInput autoFocus value={query} onChangeText={onQueryChange} placeholder="Find in chat" placeholderTextColor={ICON}
        accessibilityLabel="Find in chat" autoCorrect={false} autoCapitalize="none" returnKeyType="search"
        className="min-w-0 flex-1 px-1 py-1.5 text-[15px] text-ink outline-none" />
      {counter ? <Text accessibilityLabel={matchCount > 0 ? `${matchCount} matches` : "No matches"}
        className="shrink-0 px-1 text-[13px] text-ink-secondary">{counter}</Text> : null}
      <Pressable onPress={onPrev} disabled={disabled} accessibilityRole="button" accessibilityLabel="Previous match"
        accessibilityState={{ disabled }} className={cn(BUTTON, disabled && "opacity-50")}>
        <ChevronUp size={18} color={ICON} />
      </Pressable>
      <Pressable onPress={onNext} disabled={disabled} accessibilityRole="button" accessibilityLabel="Next match"
        accessibilityState={{ disabled }} className={cn(BUTTON, disabled && "opacity-50")}>
        <ChevronDown size={18} color={ICON} />
      </Pressable>
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close find"
        className={BUTTON}><X size={18} color={ICON} /></Pressable>
    </View>
  );
}
