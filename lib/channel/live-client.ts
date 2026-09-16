/**
 * LiveZakuraChannelClient — WebSocket transport for the `zakurabot` platform.
 *
 * Wire protocol (documented in docs/architecture.md, "Wire protocol"):
 *
 *   client → server
 *     { type: "hello",      token, client: { name, version } }
 *     { type: "send",       agentId, clientMessageId, text }
 *     { type: "interrupt",  agentId }
 *     { type: "ping" }
 *
 *   server → client
 *     { type: "ready",         agents?: Agent[] }
 *     { type: "message",       message: ChatMessage }            // chat_reply payload / user echo
 *     { type: "message_delta", agentId, messageId, delta }       // optional streaming
 *     { type: "message_done",  agentId, messageId, interrupted? }
 *     { type: "tool_activity", agentId, message: ChatMessage }   // tool chips
 *     { type: "typing",        agentId, active }
 *     { type: "error",         message, agentId?, fatal? }
 *     { type: "pong" }
 *
 * The Zakura side of this contract does not exist yet (separate PR in
 * Moonrend/Zakura). Until it does, this client reports a clear error state
 * and keeps retrying with exponential backoff so the UI can be exercised.
 */

import type { ChatMessage } from "../types";
import {
  ChannelEmitter,
  uid,
  type ChannelConnectionState,
  type ChannelEvent,
  type ChannelListener,
  type SendMessageInput,
  type ZakuraChannelClient,
} from "./types";

export interface LiveClientOptions {
  baseUrl: string;
  token: string;
  /** Override for tests; defaults to global WebSocket. */
  WebSocketImpl?: typeof WebSocket;
  /** Max reconnect delay (ms). */
  maxBackoffMs?: number;
  /** Heartbeat interval (ms); 0 disables. */
  heartbeatMs?: number;
}

export const CLIENT_INFO = { name: "zakura-bot", version: "0.2.0" } as const;

/**
 * Convert an http(s) base URL into the zakurabot WebSocket endpoint.
 * `http://host:8787` → `ws://host:8787/api/zakurabot/ws`
 */
export function zakuraSocketUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  const url = new URL(trimmed);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  if (!url.pathname.endsWith("/api/zakurabot/ws")) {
    url.pathname = `${url.pathname.replace(/\/$/, "")}/api/zakurabot/ws`;
  }
  return url.toString();
}

/** Validate settings before attempting a live connection. */
export function validateLiveSettings(input: { baseUrl: string; token: string }): string | null {
  const baseUrl = input.baseUrl.trim();
  if (!baseUrl) return "Base URL is required for the live channel.";
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return "Base URL must be an absolute URL, e.g. https://zakura.example.com";
  }
  if (!/^(https?|wss?):$/.test(parsed.protocol)) {
    return "Base URL must start with http://, https://, ws:// or wss://";
  }
  if (!input.token.trim()) return "Auth token is required for the live channel.";
  if (input.token.trim().length < 8) return "Auth token looks too short.";
  return null;
}

type ServerFrame =
  | { type: "ready"; agents?: unknown }
  | { type: "message"; message: ChatMessage }
  | { type: "message_delta"; agentId: string; messageId: string; delta: string }
  | { type: "message_done"; agentId: string; messageId: string; interrupted?: boolean }
  | { type: "tool_activity"; agentId: string; message: ChatMessage }
  | { type: "typing"; agentId: string; active: boolean }
  | { type: "error"; message: string; agentId?: string; fatal?: boolean }
  | { type: "pong" };

export class LiveZakuraChannelClient implements ZakuraChannelClient {
  readonly label = "Live WS";
  private state: ChannelConnectionState = "disconnected";
  private emitter = new ChannelEmitter();
  private socket: WebSocket | null = null;
  private closedByUser = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly opts: Required<Pick<LiveClientOptions, "maxBackoffMs" | "heartbeatMs">> &
    LiveClientOptions;

  constructor(opts: LiveClientOptions) {
    this.opts = { maxBackoffMs: 20_000, heartbeatMs: 25_000, ...opts };
  }

  getConnectionState(): ChannelConnectionState {
    return this.state;
  }

  subscribe(listener: ChannelListener): () => void {
    return this.emitter.subscribe(listener);
  }

  private setState(state: ChannelConnectionState, detail?: string) {
    this.state = state;
    this.emitter.emit({ type: "connection", state, detail });
  }

  async connect(): Promise<void> {
    this.closedByUser = false;
    const problem = validateLiveSettings({ baseUrl: this.opts.baseUrl, token: this.opts.token });
    if (problem) {
      this.setState("error", problem);
      return;
    }
    this.open();
  }

  private open() {
    const Impl = this.opts.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!Impl) {
      this.setState("error", "WebSocket is not available in this runtime.");
      return;
    }
    let url: string;
    try {
      url = zakuraSocketUrl(this.opts.baseUrl);
    } catch {
      this.setState("error", "Invalid Base URL.");
      return;
    }

    this.setState("connecting", this.attempt > 0 ? `retry #${this.attempt}` : undefined);
    let socket: WebSocket;
    try {
      socket = new Impl(url);
    } catch (err) {
      this.setState("error", err instanceof Error ? err.message : "Failed to open socket");
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.sendFrame({ type: "hello", token: this.opts.token, client: CLIENT_INFO });
    };
    socket.onmessage = (ev) => this.handleFrame(String(ev.data));
    socket.onerror = () => {
      // onclose follows; surface a hint now so the UI can show it.
      if (this.state !== "connected") {
        this.setState("error", "Could not reach Zakura. Is the zakurabot platform enabled?");
      }
    };
    socket.onclose = (ev) => {
      this.stopHeartbeat();
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.closedByUser) {
        this.setState("disconnected");
        return;
      }
      const reason = ev.reason || (ev.code === 4401 ? "Unauthorized token" : `Socket closed (${ev.code})`);
      this.setState("error", reason);
      if (ev.code === 4401 || ev.code === 4403) return; // auth failures do not retry
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.closedByUser || this.reconnectTimer) return;
    const delay = Math.min(this.opts.maxBackoffMs, 1000 * 2 ** Math.min(this.attempt, 5));
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private startHeartbeat() {
    if (!this.opts.heartbeatMs) return;
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendFrame({ type: "ping" }), this.opts.heartbeatMs);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private handleFrame(raw: string) {
    let frame: ServerFrame;
    try {
      frame = JSON.parse(raw) as ServerFrame;
    } catch {
      this.emitter.emit({ type: "error", message: "Malformed frame from Zakura" });
      return;
    }
    switch (frame.type) {
      case "ready":
        this.attempt = 0;
        this.startHeartbeat();
        this.setState("connected", "zakurabot");
        break;
      case "pong":
        break;
      case "error":
        this.emitter.emit({ type: "error", message: frame.message, agentId: frame.agentId });
        if (frame.fatal) this.disconnect();
        break;
      case "message":
      case "message_delta":
      case "message_done":
      case "tool_activity":
      case "typing":
        this.emitter.emit(frame as ChannelEvent);
        break;
      default:
        // Forward-compatible: ignore unknown frame types.
        break;
    }
  }

  private sendFrame(frame: Record<string, unknown>): boolean {
    const s = this.socket;
    if (!s || s.readyState !== 1 /* OPEN */) return false;
    s.send(JSON.stringify(frame));
    return true;
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    const s = this.socket;
    this.socket = null;
    if (s) {
      try {
        s.close(1000, "client disconnect");
      } catch {
        /* ignore */
      }
    }
    this.setState("disconnected");
  }

  async sendMessage(input: SendMessageInput): Promise<void> {
    if (this.state !== "connected") {
      throw new Error("Not connected to Zakura");
    }
    const ok = this.sendFrame({
      type: "send",
      agentId: input.agentId,
      clientMessageId: input.clientMessageId ?? uid("user"),
      text: input.text,
    });
    if (!ok) throw new Error("Socket is not open");
  }

  async interrupt(agentId: string): Promise<void> {
    this.sendFrame({ type: "interrupt", agentId });
  }
}
