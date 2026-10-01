import type { ThemePreference } from "./types";

export type ResolvedTheme = "light" | "dark";

export type ThemeColors = {
  app: string;
  panel: string;
  raised: string;
  "raised-hover": string;
  card: string;
  inset: string;
  hairline: string;
  ink: string;
  "ink-secondary": string;
  accent: string;
  "accent-border": string;
  "bubble-user": string;
  success: string;
  danger: string;
  warning: string;
};

export const darkTheme: ThemeColors = {
  app: "#070707",
  panel: "#111111",
  raised: "#2f2f2f",
  "raised-hover": "#3d3d3d",
  card: "#1f1f1f",
  inset: "#191919",
  hairline: "#333333",
  ink: "#fcfcfc",
  "ink-secondary": "#b3b3b3",
  accent: "#1084fe",
  "accent-border": "#459ffe",
  "bubble-user": "#4a4a4a",
  success: "#38d591",
  danger: "#ff5667",
  warning: "#ff9800",
};

export const lightTheme: ThemeColors = {
  app: "#ffffff",
  panel: "#f7f7f7",
  raised: "#ececec",
  "raised-hover": "#e0e0e0",
  card: "#f2f2f2",
  inset: "#efefef",
  hairline: "#e5e5e5",
  ink: "#111111",
  "ink-secondary": "#6b6b6b",
  accent: "#0a6fd6",
  "accent-border": "#0a6fd6",
  "bubble-user": "#e3e3e3",
  success: "#0a8455",
  danger: "#cf2b3e",
  warning: "#a85f00",
};

export function resolveTheme(preference: ThemePreference | undefined, system: string | null | undefined): ResolvedTheme {
  return preference === "light" || preference === "dark" ? preference : system === "light" ? "light" : "dark";
}

export function themeColors(scheme: ResolvedTheme): ThemeColors {
  return scheme === "light" ? lightTheme : darkTheme;
}

function rgbChannels(hex: string): string {
  const value = hex.replace("#", "");
  return `${parseInt(value.slice(0, 2), 16)} ${parseInt(value.slice(2, 4), 16)} ${parseInt(value.slice(4, 6), 16)}`;
}

export function themeVariables(scheme: ResolvedTheme): Record<`--color-${string}`, string> {
  const variables: Record<string, string> = {};
  for (const [name, hex] of Object.entries(themeColors(scheme))) variables[`--color-${name}`] = rgbChannels(hex);
  return variables as Record<`--color-${string}`, string>;
}
