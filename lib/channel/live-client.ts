/**
 * WebSocket implementation of the proposed zakurabot v1 contract.
 *
 * Server-side, each agent turn binds a RemoteChannelSessionHandle and posts
 * user-visible content only via chat_reply (see Zakura remote-channel-tools).
 * This client maps chat_reply / deltas / tool_activity / typing frames onto
 * ZakuraChannelClient events. The zakurabot platform adapter is still a
 * separate integration task — see docs/architecture.md.
 */
import { version } from "../../package.json";
import type { Agent } from "../types";
import { decodeServerFrame, isChannelId, PROTOCOL_VERSION } from "./protocol";
import {
  ChannelEmitter, MAX_MESSAGE_LENGTH, uid,
  type ChannelConnectionState, type ChannelListener,
  type SendMessageInput, type ZakuraChannelClient,
} from "./types";

export interface LiveClientOptions {
  baseUrl: string;
  token: string;
  WebSocketImpl?: typeof WebSocket;
  maxBackoffMs?: number;
  /** Time allowed for the socket to open AND receive an authenticated ready. */
  handshakeTimeoutMs?: number;
  /** Heartbeat interval; 0 disables heartbeats. */
  heartbeatMs?: number;
  pongTimeoutMs?: number;
  /** Time to wait for a correlated user echo after a socket write. */
  acknowledgementTimeoutMs?: number;
}

export const CLIENT_INFO = { name: "zakura-bot", version } as const;

function parseBaseUrl(baseUrl: string): URL {
  const url = new URL(baseUrl.trim());
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    throw new Error("Base URL must start with http://, https://, ws:// or wss://.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Base URL must not include credentials, a query, or a fragment.");
  }
  return url;
}

/** Retain reverse-proxy path prefixes; credentials travel only in hello. */
export function zakuraSocketUrl(baseUrl: string): string {
  const url = parseBaseUrl(baseUrl);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/api/zakurabot/ws")) url.pathname += "/api/zakurabot/ws";
  return url.toString();
}

export function validateLiveSettings(input: { baseUrl: string; token: string }): string | null {
  if (!input.baseUrl.trim()) return "Base URL is required for the live channel.";
  try { parseBaseUrl(input.baseUrl); } catch (error) {
    return error instanceof TypeError
      ? "Base URL must be an absolute URL, e.g. https://zakura.example.com."
      : (error as Error).message;
  }
  if (!input.token.trim()) return "Auth token is required for the live channel.";
  return null;
}

type Timer = ReturnType<typeof setTimeout>;
const key = (agentId: string, messageId: string) => JSON.stringify([agentId, messageId]);
type PendingWrite = { agentId: string; text: string; timer: Timer };

export class LiveZakuraChannelClient implements ZakuraChannelClient {
  readonly label = "Live WS";
  private state: ChannelConnectionState = "disconnected";
  private emitter = new ChannelEmitter();
  private socket: WebSocket | null = null;
  private closedByUser = true;
  private attempt = 0;
  private reconnectTimer: Timer | null = null;
  private handshakeTimer: Timer | null = null;
  private closeTimer: Timer | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: Timer | null = null;
  private roster = new Map<string, Agent["status"]>();
  // Retain completed ids until disconnect so a repeated announcement cannot
  // reopen a finished reply. A reconnect starts a fresh snapshot/stream scope.
  private replies = new Map<string, { agentId: string; active: boolean }>();
  private acknowledgements = new Map<string, PendingWrite>();

  constructor(private readonly opts: LiveClientOptions) {}

  getConnectionState(): ChannelConnectionState { return this.state; }
  subscribe(listener: ChannelListener): () => void { return this.emitter.subscribe(listener); }

  private setState(state: ChannelConnectionState, detail?: string) {
    this.state = state;
    this.emitter.emit({ type: "connection", state, detail });
  }

  /** Idempotent; resolves after starting the connection, not authentication. */
  async connect(): Promise<void> {
    if (this.socket || this.reconnectTimer || (this.state === "connecting" && !this.closedByUser)) return;
    const problem = validateLiveSettings({ baseUrl: this.opts.baseUrl, token: this.opts.token });
    if (problem) { this.setState("error", problem); return; }
    this.closedByUser = false;
    this.attempt = 0;
    this.open();
  }

  private open() {
    if (this.closedByUser || this.socket) return;
    const Impl = this.opts.WebSocketImpl ?? globalThis.WebSocket;
    if (!Impl) { this.fail("WebSocket is not available in this runtime.", false); return; }
    this.setState("connecting", this.attempt ? `Retry ${this.attempt}` : undefined);
    if (this.closedByUser || this.socket) return;
    let socket: WebSocket;
    try { socket = new Impl(zakuraSocketUrl(this.opts.baseUrl)); } catch {
      this.fail("Could not open the Zakura connection.", true);
      return;
    }
    this.socket = socket;
    const current = () => this.socket === socket && !this.closedByUser;
    this.handshakeTimer = setTimeout(() => {
      if (current()) this.fail("Zakura did not complete the channel handshake.", true);
    }, this.opts.handshakeTimeoutMs ?? 10_000);

    socket.onopen = () => {
      if (!current()) return;
      if (!this.sendFrame({ type: "hello", protocol: PROTOCOL_VERSION, token: this.opts.token.trim(), client: CLIENT_INFO })) {
        this.fail("Could not send the channel handshake.", true);
      }
    };
    socket.onmessage = (event) => {
      if (!current()) return;
      if (typeof event.data !== "string") {
        this.emitter.emit({ type: "error", message: "Zakura sent a non-text channel frame." });
        return;
      }
      this.handleFrame(event.data);
    };
    socket.onerror = () => {
      if (!current() || this.closeTimer) return;
      // Browsers fire error before close. Keep the close handler long enough to
      // receive an auth/policy code instead of turning it into an endless retry.
      const detail = "Could not reach Zakura. Check the URL and channel configuration.";
      this.setState("error", detail);
      if (current()) this.closeTimer = setTimeout(() => {
        if (current()) this.fail(detail, true);
      }, 1000);
    };
    socket.onclose = (event) => {
      if (!current()) return;
      const authFailure = [1008, 4401, 4403].includes(event.code);
      const detail = event.code === 4401 ? "Authentication failed. Check your token in Settings."
        : event.code === 4403 || event.code === 1008 ? "Channel access denied. Check your binding and token."
          : `Connection closed (${event.code}). Reconnecting…`;
      this.fail(detail, !authFailure);
    };
  }

  private fail(detail: string, retry: boolean) {
    this.releaseSocket();
    if (!retry) this.closedByUser = true;
    this.setState("error", detail);
    if (retry) this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.closedByUser || this.socket || this.reconnectTimer) return;
    const delay = Math.min(this.opts.maxBackoffMs ?? 20_000, 1000 * 2 ** Math.min(this.attempt, 5));
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private startHeartbeat(socket: WebSocket) {
    const interval = this.opts.heartbeatMs ?? 25_000;
    if (interval <= 0 || this.heartbeatTimer || this.socket !== socket || this.state !== "connected") return;
    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== socket || this.state !== "connected" || this.pongTimer) return;
      this.pongTimer = setTimeout(() => {
        if (this.socket === socket) this.fail("Zakura stopped responding. Reconnecting…", true);
      }, this.opts.pongTimeoutMs ?? 10_000);
      if (!this.sendFrame({ type: "ping" })) this.fail("Connection lost. Reconnecting…", true);
    }, interval);
  }

  private handleFrame(raw: string) {
    const socket = this.socket;
    let frame;
    try { frame = decodeServerFrame(raw); } catch (error) {
      this.emitter.emit({ type: "error", message: (error as Error).message });
      return;
    }
    if (!frame) return;
    if (frame.type === "error") {
      if (frame.fatal) { this.fail(frame.message, false); return; }
      if (frame.agentId && (this.state !== "connected" || !this.roster.has(frame.agentId))) return;
      // A delayed rejection must not fail a delivered message or a newer turn.
      if (frame.clientMessageId && frame.agentId && !this.acknowledge(frame.agentId, frame.clientMessageId)) return;
      if (frame.agentId && !frame.clientMessageId && frame.turnEnded !== false) this.endReplies(frame.agentId);
      this.emitter.emit(frame);
      return;
    }
    if (frame.type === "ready") {
      if (this.state !== "connecting") return;
      if (frame.protocol !== PROTOCOL_VERSION) {
        this.fail("This server uses an unsupported channel protocol.", false);
        return;
      }
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
      this.attempt = 0;
      this.updateRoster(frame.agents);
      // Subscribers can disconnect or replace the client during either event.
      if (this.socket !== socket || this.closedByUser) return;
      this.setState("connected", "zakurabot");
      if (socket) this.startHeartbeat(socket);
      return;
    }
    // Do not accept data before the authenticated roster arrives.
    if (this.state !== "connected") return;
    const agentId = "message" in frame ? frame.message.agentId : "agentId" in frame ? frame.agentId : undefined;
    if (agentId && !this.roster.has(agentId)) return;
    switch (frame.type) {
      case "agents":
        this.updateRoster(frame.agents);
        break;
      case "pong":
        if (this.pongTimer) clearTimeout(this.pongTimer);
        this.pongTimer = null;
        break;
      case "chat_reply": {
        const messageKey = key(frame.message.agentId, frame.message.id);
        if (frame.message.streaming && (this.replies.has(messageKey) || this.roster.get(frame.message.agentId) === "offline")) return;
        this.replies.set(messageKey, { agentId: frame.message.agentId, active: !!frame.message.streaming });
        this.emitter.emit({ type: "message", message: frame.message });
        break;
      }
      case "message_delta":
      case "message_done": {
        const messageKey = key(frame.agentId, frame.messageId);
        // Deltas can only update a previously announced chat_reply bubble.
        const reply = this.replies.get(messageKey);
        if (!reply?.active) return;
        if (frame.type === "message_done") reply.active = false;
        this.emitter.emit(frame);
        break;
      }
      case "message":
        if (frame.message.role === "user") {
          this.acknowledge(frame.message.agentId, frame.message.clientMessageId ?? frame.message.id);
        }
        this.emitter.emit(frame);
        break;
      case "typing":
        if (frame.active && this.roster.get(frame.agentId) === "offline") return;
        if (!frame.active) this.endReplies(frame.agentId);
        this.emitter.emit(frame);
        break;
      default:
        if (this.roster.get(frame.agentId) === "offline" && frame.message.tool?.ok === undefined && !frame.message.tool?.interrupted) return;
        this.emitter.emit(frame);
    }
  }

  private updateRoster(agents: Agent[]) {
    this.roster = new Map(agents.map((agent) => [agent.id, agent.status]));
    for (const [messageKey, reply] of this.replies) {
      if (!this.roster.has(reply.agentId)) this.replies.delete(messageKey);
      else if (this.roster.get(reply.agentId) === "offline") reply.active = false;
    }
    for (const [messageKey, pending] of this.acknowledgements) {
      if (!this.roster.has(pending.agentId) || this.roster.get(pending.agentId) === "offline") {
        clearTimeout(pending.timer);
        this.acknowledgements.delete(messageKey);
      }
    }
    this.emitter.emit({ type: "agents", agents });
  }

  private endReplies(agentId: string) {
    for (const reply of this.replies.values()) if (reply.agentId === agentId) reply.active = false;
  }

  private acknowledge(agentId: string, messageId: string): boolean {
    const messageKey = key(agentId, messageId);
    const pending = this.acknowledgements.get(messageKey);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.acknowledgements.delete(messageKey);
    return true;
  }

  private sendFrame(frame: Record<string, unknown>): boolean {
    if (!this.socket || this.socket.readyState !== 1) return false;
    try { this.socket.send(JSON.stringify(frame)); return true; } catch { return false; }
  }

  private releaseSocket() {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.handshakeTimer = this.heartbeatTimer = this.pongTimer = this.closeTimer = null;
    for (const pending of this.acknowledgements.values()) clearTimeout(pending.timer);
    this.acknowledgements.clear();
    this.replies.clear();
    this.roster.clear();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try { socket.close(1000, "client disconnect"); } catch { /* Already closed. */ }
    }
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.releaseSocket();
    this.setState("disconnected");
  }

  async sendMessage(input: SendMessageInput): Promise<void> {
    if (this.state !== "connected") throw new Error("Not connected to Zakura.");
    this.requireAvailableAgent(input.agentId);
    const text = input.text.trim();
    if (!text || text.length > MAX_MESSAGE_LENGTH) throw new Error(`Use 1–${MAX_MESSAGE_LENGTH} characters per message.`);
    const clientMessageId = input.clientMessageId ?? uid("user");
    if (!isChannelId(clientMessageId)) throw new Error("Invalid message id.");
    const messageKey = key(input.agentId, clientMessageId);
    const previous = this.acknowledgements.get(messageKey);
    if (previous) {
      if (previous.text !== text) throw new Error("A pending message id cannot be reused for different text.");
      return;
    }
    const pending: PendingWrite = { agentId: input.agentId, text, timer: setTimeout(() => {
      if (this.acknowledgements.get(messageKey) !== pending) return;
      this.acknowledgements.delete(messageKey);
      this.emitter.emit({ type: "error", agentId: input.agentId, clientMessageId,
        message: "Delivery was not confirmed. Retry this message to check or resend it." });
    }, this.opts.acknowledgementTimeoutMs ?? 15_000) };
    this.acknowledgements.set(messageKey, pending);
    if (!this.sendFrame({ type: "send", agentId: input.agentId, clientMessageId, text })) {
      this.acknowledge(input.agentId, clientMessageId);
      this.fail("Connection lost. Reconnecting…", true);
      throw new Error("The message could not be written to the connection.");
    }
  }

  async interrupt(agentId: string): Promise<void> {
    if (this.state !== "connected") throw new Error("Could not stop the reply. Check the channel connection.");
    this.requireAvailableAgent(agentId);
    if (!this.sendFrame({ type: "interrupt", agentId })) {
      this.fail("Connection lost. Reconnecting…", true);
      throw new Error("Could not stop the reply. Check the channel connection.");
    }
  }

  private requireAvailableAgent(agentId: string) {
    if (!isChannelId(agentId) || !this.roster.has(agentId)) throw new Error("This agent is no longer available in the channel.");
    if (this.roster.get(agentId) === "offline") throw new Error("This agent is offline. Choose an available agent.");
  }
}
