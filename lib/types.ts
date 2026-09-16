/** Shared UI / domain types for Zakura Bot. */

export type AgentStatus = "idle" | "busy" | "offline";

export type MessageKind = "text" | "activity" | "system";

export type MessageRole = "user" | "assistant" | "system";

export interface ToolActivity {
  name: string;
  /** undefined = running, true = ok, false = failed */
  ok?: boolean;
  detail?: string;
}

export interface ChatMessage {
  id: string;
  agentId: string;
  role: MessageRole;
  kind: MessageKind;
  text?: string;
  tool?: ToolActivity;
  createdAt: number;
  /** true while assistant tokens are still streaming in */
  streaming?: boolean;
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

export interface AppSettings {
  zakuraBaseUrl: string;
  authToken: string;
  /** When true, use MockZakuraChannelClient instead of a live transport */
  useMockChannel: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  zakuraBaseUrl: "http://127.0.0.1:8787",
  authToken: "",
  useMockChannel: true,
};
