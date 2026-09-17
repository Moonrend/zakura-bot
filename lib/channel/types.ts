/**
 * ZakuraChannelClient — transport contract for the `zakurabot` platform.
 *
 * Ships a mock plus a live WebSocket client for the Zakura v1 gateway.
 * The server, device setup and optional streaming extension are documented in
 * docs/architecture.md; server services are maintained in Moonrend/Zakura.
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
  /** Local request state; cleared by turn completion, roster recovery or refusal. */
  | { type: "interrupt_pending"; agentId: string; pending: boolean }
  | { type: "error"; message: string; agentId?: string; clientMessageId?: string;
      /** Only true explicitly ends a turn. v1 wire errors normalize to false. */
      turnEnded?: boolean };

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
