/**
 * ZakuraChannelClient — transport contract for the future `zakurabot` platform.
 *
 * Phase 1 ships a mock implementation. A later PR in Moonrend/Zakura will add a
 * Chat-SDK–style platform adapter; this client will then speak WS or SSE and
 * surface outbound `chat_reply` events as assistant bubbles / attachments.
 */

import type { ChatMessage } from "../types";

export type ChannelConnectionState = "disconnected" | "connecting" | "connected" | "error";

export type ChannelEvent =
  | { type: "connection"; state: ChannelConnectionState; detail?: string }
  | { type: "message"; message: ChatMessage }
  | { type: "message_delta"; agentId: string; messageId: string; delta: string }
  | { type: "message_done"; agentId: string; messageId: string }
  | { type: "tool_activity"; agentId: string; message: ChatMessage }
  | { type: "typing"; agentId: string; active: boolean }
  | { type: "error"; message: string };

export type ChannelListener = (event: ChannelEvent) => void;

export interface SendMessageInput {
  agentId: string;
  text: string;
  /** Client-generated id; server may echo or remap */
  clientMessageId?: string;
}

export interface ZakuraChannelClient {
  /** Connect to Zakura (WS/SSE). Mock resolves immediately. */
  connect(): Promise<void>;
  disconnect(): void;
  getConnectionState(): ChannelConnectionState;
  /** Subscribe to channel events; returns unsubscribe. */
  subscribe(listener: ChannelListener): () => void;
  /** Send a user message into the agent thread. */
  sendMessage(input: SendMessageInput): Promise<void>;
  /** Optional interrupt for the current turn. */
  interrupt?(agentId: string): Promise<void>;
}
