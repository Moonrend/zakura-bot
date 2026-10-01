/**
 * ZakuraChannelClient — transport contract for the `zakurabot` platform.
 *
 * Ships a mock plus a live WebSocket client for the Zakura v1 gateway.
 * The server, device setup and optional streaming extension are documented in
 * docs/architecture.md; server services are maintained in Moonrend/Zakura.
 */

import type { Agent, ChatMessage, MessageAttachment } from "../types";

export const MAX_MESSAGE_LENGTH = 4000;

export type ChannelConnectionState = "disconnected" | "connecting" | "connected" | "error";

export type ChannelEvent =
  | { type: "connection"; state: ChannelConnectionState; detail?: string; authFailure?: boolean }
  | { type: "agents"; agents: Agent[] }
  | { type: "message"; message: ChatMessage }
  | { type: "message_delta"; agentId: string; messageId: string; delta: string }
  | { type: "message_done"; agentId: string; messageId: string; interrupted?: boolean }
  | { type: "tool_activity"; agentId: string; message: ChatMessage }
  | { type: "typing"; agentId: string; active: boolean }
  /** Live reaction broadcast; the wire frame has no agent id, so the store scopes it by message. */
  | { type: "reaction"; messageId: string; emoji: string; userId: string; op: "add" | "remove" }
  /** Local request state; cleared by turn completion, roster recovery or refusal. */
  | { type: "interrupt_pending"; agentId: string; pending: boolean }
  | { type: "error"; message: string; agentId?: string; clientMessageId?: string;
      /** Only true explicitly ends a turn. v1 wire errors normalize to false. */
      turnEnded?: boolean };

export type ChannelListener = (event: ChannelEvent) => void;

export interface ChannelHistoryPage {
  messages: ChatMessage[];
  /** Cursor for the next older page; null means the conversation start. */
  nextBefore: number | null;
}

export interface SendMessageInput {
  agentId: string;
  text: string;
  attachments?: MessageAttachment[];
  /** Stable idempotency key. The server must include it in its user echo. */
  clientMessageId?: string;
  /** Timestamp of the optimistic bubble, for local ordering only; never sent on the wire. */
  localCreatedAt?: number;
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
  /**
   * Optional REST history for transports that persist frames. Not available on
   * the mock channel; callers must feature-detect before offering it.
   */
  fetchHistory?(agentId: string, before?: number, limit?: number): Promise<ChannelHistoryPage>;
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
