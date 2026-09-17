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
  /** Resolved by the platform adapter; workspace paths never reach the client. */
  url: string;
  name?: string;
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
  tool?: ToolActivity;
  createdAt: number;
  /** User echo correlation, even if the server assigns a different id. */
  clientMessageId?: string;
  serverId?: string;
  /** Socket writes are pending until the server echoes the user message. */
  pending?: boolean;
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
}

export type ChannelMode = "mock" | "live";

export interface AppSettings {
  zakuraBaseUrl: string;
  authToken: string;
  /** When true, use MockZakuraChannelClient instead of a live transport */
  useMockChannel: boolean;
  profileId?: string;
  onboardingComplete?: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  zakuraBaseUrl: "http://127.0.0.1:8787",
  authToken: "",
  useMockChannel: true,
  onboardingComplete: false,
};
