/** Shared UI / domain types for Zakura Bot. */

export type AgentStatus = "idle" | "busy" | "offline";

export type MessageKind = "text" | "activity" | "system";

export type MessageRole = "user" | "assistant" | "system";

export interface ToolActivity {
  name: string;
  /** undefined = running, true = ok, false = failed */
  ok?: boolean;
  detail?: string;
  /** Cancelled work is distinct from a failed tool call. */
  interrupted?: boolean;
}

export interface MessageLink {
  label: string;
  url: string;
  style?: "primary" | "danger" | "default";
}

export interface MessageAttachment {
  /** Uploaded file identity. Download through the current device's scoped API. */
  id?: string;
  /** Resolved by the platform adapter; workspace paths never reach the client. */
  url: string;
  name?: string;
  mime?: string;
  size?: number;
  type?: "image" | "file" | "audio" | "video";
}

export interface MessageCard {
  title?: string;
  subtitle?: string;
  text?: string;
  imageUrl?: string;
  fields?: { label: string; value: string }[];
  table?: { headers: string[]; rows: string[][] };
  images?: { url: string; alt?: string }[];
  links?: MessageLink[];
}

/** Additive chat_reply metadata; the card remains usable by older clients. */
export interface MessageInteraction {
  type: "approval" | "question" | "form";
  requestId: string;
  status: "pending" | "answered" | "cancelled" | "skipped" | "timeout" | "resolved";
  title: string;
  options?: { id: string; label: string; description?: string; kind?: string }[];
  allowMultiple?: boolean;
  secret?: boolean;
  mode?: "sync" | "async" | "form" | "url";
  expiresAt?: string | null;
  placeholder?: string;
  url?: string;
  fields?: { id: string; type: string; title?: string; required?: boolean; options?: string[] }[];
}

export interface InteractionAnswer {
  cancelled?: boolean;
  optionId?: string;
  selected?: string[];
  text?: string;
  content?: Record<string, string | number | boolean | string[]>;
}

export interface ChatMessage {
  id: string;
  agentId: string;
  role: MessageRole;
  kind: MessageKind;
  text?: string;
  format?: "markdown" | "raw";
  replyTo?: string;
  attachments?: MessageAttachment[];
  actions?: MessageLink[];
  card?: MessageCard;
  interaction?: MessageInteraction;
  tool?: ToolActivity;
  createdAt: number;
  /** User echo correlation, even if the server assigns a different id. */
  clientMessageId?: string;
  serverId?: string;
  /** Socket writes are pending until the server echoes the user message. */
  pending?: boolean;
  /** Held while the channel is offline; the store sends it after reconnecting. */
  queued?: boolean;
  /** true while assistant tokens are still streaming in */
  streaming?: boolean;
  /** Set when the turn was interrupted before completion */
  interrupted?: boolean;
  /** Set on user messages that the channel refused (e.g. offline) */
  failed?: boolean;
}

export interface Agent {
  id: string;
  name: string;
  title?: string;
  color: string;
  status: AgentStatus;
  unread: boolean;
  preview?: string;
  bindingId?: string;
  description?: string;
  spaceId?: string | null;
  spaceName?: string | null;
  avatarColor?: string | null;
  avatarShape?: string | null;
  avatarUrl?: string | null;
  capabilities?: { files: boolean; desktop: boolean; interactions: boolean };
}

export type ChannelMode = "mock" | "live";

export interface AppSettings {
  zakuraBaseUrl: string;
  authToken: string;
  /** When true, use MockZakuraChannelClient instead of a live transport */
  useMockChannel: boolean;
  profileId?: string;
  onboardingComplete?: boolean;
  /** 绑定的 Space；空 = 默认空间。旧服务端无 spaces 时忽略 */
  spaceId?: string;
  spaceName?: string;
  theme?: ThemePreference;
}

export type ThemePreference = "system" | "light" | "dark";

export const DEFAULT_SETTINGS: AppSettings = {
  zakuraBaseUrl: "http://100.81.13.25:8787",
  authToken: "",
  useMockChannel: true,
  onboardingComplete: false,
  theme: "system",
};
