/**
 * ZakuraChannelClient — transport contract for the `zakurabot` platform.
 *
 * Phase 1 ships a mock implementation plus a live WebSocket client whose wire
 * format is documented in docs/architecture.md. The server-side platform
 * adapter lands separately in Moonrend/Zakura; until then the live client
 * connects, fails, and reports a clear error state.
 */

import type { Agent, ChatMessage } from "../types";

export const MAX_MESSAGE_LENGTH = 4000;

export type ChannelConnectionState = "disconnected" | "connecting" | "connected" | "error";

export type ChannelEvent =
  | { type: "connection"; state: ChannelConnectionState; detail?: string }
  | { type: "agents"; agents: Agent[] }
  | { type: "message"; message: ChatMessage }
  | { type: "message_delta"; agentId: string; messageId: string; delta: string }
  | { type: "message_done"; agentId: string; messageId: string; interrupted?: boolean }
  | { type: "tool_activity"; agentId: string; message: ChatMessage }
  | { type: "typing"; agentId: string; active: boolean }
  | { type: "error"; message: string; agentId?: string; clientMessageId?: string };

export type ChannelListener = (event: ChannelEvent) => void;

export interface SendMessageInput {
  agentId: string;
  text: string;
  /** Stable idempotency key. The server must include it in its user echo. */
  clientMessageId?: string;
}

export interface ZakuraChannelClient {
  /** Human-readable transport label shown in the UI ("Mock", "Live WS"). */
  readonly label: string;
  /** Connect to Zakura (WS/SSE). Mock resolves after a short delay. */
  connect(): Promise<void>;
  disconnect(): void;
  getConnectionState(): ChannelConnectionState;
  /** Subscribe to channel events; returns unsubscribe. */
  subscribe(listener: ChannelListener): () => void;
  /**
   * Send a user message into the agent thread.
   * Rejects (throws) when the channel is not connected so the UI can keep
   * the draft and mark the message as failed. Resolution means written to the
   * transport, not acknowledged by the server; a user echo confirms delivery.
   */
  sendMessage(input: SendMessageInput): Promise<void>;
  /** Optional interrupt for the current turn. */
  interrupt?(agentId: string): Promise<void>;
}

/** Shared helpers for client implementations. */
export function uid(prefix = "msg"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class ChannelEmitter {
  private listeners = new Set<ChannelListener>();

  subscribe(listener: ChannelListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(...events: ChannelEvent[]): void {
    for (const event of events) {
      for (const l of Array.from(this.listeners)) l(event);
    }
  }
}
