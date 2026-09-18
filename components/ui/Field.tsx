import { forwardRef, useState, type ReactNode } from "react";
import { Platform, Text, TextInput, View, type TextInputProps } from "react-native";
import { cn } from "@/lib/cn";

/** Fluid Functionalism InputField: rest is unboxed; hover/focus pick up a 1px ring. */
export const Field = forwardRef<TextInput, TextInputProps & {
  label?: string;
  error?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  containerClassName?: string;
}>(function Field({ label, error, icon, trailing, containerClassName, className, onFocus, onBlur, editable = true, ...input }, ref) {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const active = focused || hovered;
  return (
    <View className={cn("gap-1", containerClassName)}
      {...(Platform.OS === "web" ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) } : {})}>
      {label ? <Text className={cn("pl-2.5 text-[13px]", error ? "text-danger" : "text-ink-secondary")}>{label}</Text> : null}
      <View className={cn(
        "min-h-11 flex-row items-center gap-2 rounded-xl border px-2.5",
        !editable && "opacity-50",
        error ? (focused ? "border-danger bg-panel" : active ? "border-danger bg-raised/40" : "border-transparent")
          : focused ? "border-accent-border bg-panel"
          : active ? "border-hairline bg-raised/40"
          : "border-transparent",
      )}>
        {icon}
        <TextInput ref={ref} editable={editable} placeholderTextColor="#a3a3a3"
          onFocus={(event) => { setFocused(true); onFocus?.(event); }}
          onBlur={(event) => { setFocused(false); onBlur?.(event); }}
          className={cn("min-w-0 min-h-11 flex-1 py-3 text-[15px] text-ink outline-none", className)}
          {...input} />
        {trailing}
      </View>
      {error ? <Text accessibilityRole="alert" className="pl-2.5 text-[12px] text-danger">{error}</Text> : null}
    </View>
  );
});
