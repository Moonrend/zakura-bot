import type { Agent } from "./types";

/** Avatar silhouettes; the id is stored in agent.avatarShape. */
export interface AvatarShape { id: string; label: string }
/** Swatch values are stored in agent.avatarColor. */
export interface AvatarColor { id: string; value: string; label: string }

export const AVATAR_SHAPES: readonly AvatarShape[] = [
  { id: "circle", label: "Circle" },
  { id: "squircle", label: "Squircle" },
  { id: "rounded", label: "Rounded square" },
  { id: "square", label: "Square" },
  { id: "hexagon", label: "Hexagon" },
  { id: "diamond", label: "Diamond" },
  { id: "blob", label: "Blob" },
  { id: "drop", label: "Drop" },
];

/** Ten medium-saturation hues around the wheel, readable behind light ink. */
export const AVATAR_COLORS: readonly AvatarColor[] = [
  { id: "red", value: "#e5484d", label: "Red" },
  { id: "orange", value: "#f76b15", label: "Orange" },
  { id: "amber", value: "#e0a020", label: "Amber" },
  { id: "green", value: "#30a46c", label: "Green" },
  { id: "teal", value: "#12a594", label: "Teal" },
  { id: "cyan", value: "#0e9dc9", label: "Cyan" },
  { id: "blue", value: "#1084fe", label: "Blue" },
  { id: "violet", value: "#8e4ec6", label: "Violet" },
  { id: "pink", value: "#e93d82", label: "Pink" },
  { id: "slate", value: "#6e7681", label: "Slate" },
];

export const DEFAULT_AVATAR_SHAPE = "circle";
export const DEFAULT_AVATAR_COLOR = "#1084fe";

const SHAPE_IDS = new Set(AVATAR_SHAPES.map((shape) => shape.id));

/** Normalize a stored shape id, falling back to the legacy round silhouette. */
export function avatarShapeId(shape?: string | null): string {
  return shape && SHAPE_IDS.has(shape) ? shape : DEFAULT_AVATAR_SHAPE;
}

/** A stored avatar color is used only when it is a plain hex value. */
export function avatarColorValue(color?: string | null): string {
  return color && /^#[\da-f]{6}$/i.test(color) ? color : DEFAULT_AVATAR_COLOR;
}

/** Resolve the avatar props for an agent: the image wins, then the chosen pair, then the legacy color. */
export function avatarFields(agent: Pick<Agent, "color" | "avatarColor" | "avatarShape" | "avatarUrl">) {
  return {
    color: agent.avatarColor ? avatarColorValue(agent.avatarColor) : agent.color,
    shape: agent.avatarShape ?? null,
    url: agent.avatarUrl ?? null,
  };
}
