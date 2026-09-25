/**
 * WebSocket implementation of the zakurabot v1 contract.
 *
 * Server-side, each agent turn binds a RemoteChannelSessionHandle and posts
 * user-visible content only via chat_reply (see Zakura remote-channel-tools).
 * This client maps chat_reply / deltas / tool_activity / typing frames onto
 * ZakuraChannelClient events. The zakurabot platform adapter is still a
 * server deployment — see docs/architecture.md.
 */
import { version } from "../../package.json";
import type { Agent, ChatMessage } from "../types";
import { attachmentIdentity, fileMessageText } from "../files";
import { attachmentReferences, channelCloseFailure, decodeServerFrame, InvalidChannelFrameError, isChannelId, PROTOCOL_VERSION, UnsupportedChannelProtocolError } from "./protocol";
import {
  ChannelEmitter, MAX_MESSAGE_LENGTH, uid,
  type ChannelConnectionState, type ChannelListener,
  type SendMessageInput, type ZakuraChannelClient,
} from "./types";

export interface ChannelNetworkStatus {
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}

export interface LiveClientOptions {
  baseUrl: string;
  token: string;
  getToken?: () => Promise<string>;
  WebSocketImpl?: typeof WebSocket;
  maxBackoffMs?: number;
  /** Time allowed for the socket to open AND receive an authenticated ready. */
  handshakeTimeoutMs?: number;
  /** Heartbeat interval; 0 disables heartbeats. */
  heartbeatMs?: number;
  pongTimeoutMs?: number;
  /** Time to wait for a correlated user echo after a socket write. */
  acknowledgementTimeoutMs?: number;
  /** Wait for turn completion, an idle roster without live work, or a refusal. */
  interruptTimeoutMs?: number;
  /** Defaults to browser online/offline events; native clients use socket liveness. */
  network?: ChannelNetworkStatus;
}

export const CLIENT_INFO = { name: "zakura-bot", version } as const;
const NETWORK_OFFLINE = "Network offline. Reconnecting when your network is back.";
const BACKOFF_RESET_MS = 60_000;

function browserNetworkStatus(): ChannelNetworkStatus | undefined {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function" || typeof navigator === "undefined") return;
  return {
    isOnline: () => navigator.onLine !== false,
    subscribe(listener) {
      const update = () => listener(navigator.onLine !== false);
      window.addEventListener("online", update);
      window.addEventListener("offline", update);
      return () => {
        window.removeEventListener("online", update);
        window.removeEventListener("offline", update);
      };
    },
  };
}

function parseBaseUrl(baseUrl: string): URL {
  const url = new URL(baseUrl.trim());
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    throw new Error("Base URL must start with http://, https://, ws:// or wss://.");
  }
  // URL.search/hash omit empty delimiters, but a trailing '#' still makes
  // WebSocket reject the URL. Reject those configurations before retrying.
  if (url.username || url.password || /[?#]/.test(url.href)) {
    throw new Error("Base URL must not include credentials, a query, or a fragment.");
  }
  return url;
}

/** Retain reverse-proxy path prefixes; credentials travel only in hello. */
export function zakuraSocketUrl(baseUrl: string): string {
  const url = parseBaseUrl(baseUrl);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  // Assign only after joining: URL.pathname normalizes an empty path to '/'.
  const prefix = url.pathname.replace(/\/+$/, "");
  url.pathname = prefix.endsWith("/api/zakurabot/ws") ? prefix : `${prefix}/api/zakurabot/ws`;
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
  if (input.token.trim().length > 4096) return "Auth token is too long. Paste the full Zakura access token.";
  return null;
}

type Timer = ReturnType<typeof setTimeout>;
const key = (agentId: string, messageId: string) => JSON.stringify([agentId, messageId]);
type PendingWrite = { agentId: string; text: string; timer: Timer };
type SentMessage = { agentId: string; text: string; attachments?: ChatMessage["attachments"]; createdAt: number; echo?: ChatMessage };
type ReceiptAlias = { agentId: string; clientMessageId: string };
type OutputIdentity = Pick<ChatMessage, "agentId" | "role" | "kind">;
type PendingInterrupt = { timer: Timer | null };

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
  private backoffResetTimer: Timer | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: Timer | null = null;
  private roster = new Map<string, Agent["status"]>();
  // Retain settled ids across sockets so replayed starts cannot reopen output.
  // Without a stream cursor, only a complete snapshot can restore an old reply.
  private replies = new Map<string, { agentId: string; active: boolean }>();
  private activities = new Map<string, { agentId: string; active: boolean }>();
  private liveTyping = new Set<string>();
  private acknowledgements = new Map<string, PendingWrite>();
  // Keep idempotency content through retries and reconnects, until access is removed.
  private sentMessages = new Map<string, SentMessage>();
  private receiptAliases = new Map<string, ReceiptAlias>();
  // Unlike active streams, message identities outlive the socket. A receipt
  // must not be acknowledged if its ids would replace a reply, tool or notice.
  private outputIdentities = new Map<string, OutputIdentity>();
  // At most one outstanding stop request per agent.
  private interrupts = new Map<string, PendingInterrupt>();
  private network: ChannelNetworkStatus | undefined;
  private unsubscribeNetwork: (() => void) | null = null;

  constructor(private readonly opts: LiveClientOptions) {
    this.network = opts.network ?? browserNetworkStatus();
  }

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
    this.observeNetwork();
    this.open();
  }

  private observeNetwork() {
    if (!this.network || this.unsubscribeNetwork) return;
    this.unsubscribeNetwork = this.network.subscribe((online) => {
      if (this.closedByUser) return;
      if (!online) {
        // Offline may arrive before error/close, even when the socket is
        // already closing. Keep its pending auth/policy code through grace.
        if (!this.closeTimer && !this.awaitClosingSocket(NETWORK_OFFLINE)) this.fail(NETWORK_OFFLINE, true);
      } else if (!this.socket) {
        this.cancelReconnect();
        this.attempt = 0;
        this.open();
      }
    });
  }

  private stopObservingNetwork() {
    this.unsubscribeNetwork?.();
    this.unsubscribeNetwork = null;
  }

  private open() {
    if (this.closedByUser || this.socket) return;
    if (this.network?.isOnline() === false) { this.setState("error", NETWORK_OFFLINE); return; }
    const Impl = this.opts.WebSocketImpl ?? globalThis.WebSocket;
    if (!Impl) { this.fail("WebSocket is not available in this runtime.", false); return; }
    this.setState("connecting", this.attempt ? `Retry ${this.attempt}` : undefined);
    if (this.closedByUser || this.socket || this.network?.isOnline() === false) return;
    let socket: WebSocket;
    try { socket = new Impl(zakuraSocketUrl(this.opts.baseUrl)); } catch {
      this.fail("Could not open the Zakura connection.", true);
      return;
    }
    this.socket = socket;
    const current = () => this.socket === socket && !this.closedByUser;
    this.handshakeTimer = setTimeout(() => {
      if (current()) this.failSocket("Zakura did not complete the channel handshake.");
    }, this.opts.handshakeTimeoutMs ?? 10_000);

    socket.onopen = () => {
      if (!current()) return;
      const hello = (token: string) => {
        if (!current()) return;
        if (!this.sendFrame({ type: "hello", protocol: PROTOCOL_VERSION, token: token.trim(), client: CLIENT_INFO })) this.failSocket("Could not send the channel handshake.");
      };
      if (this.opts.getToken) void this.opts.getToken().then(hello).catch((error: unknown) => {
        if (current()) this.fail(error instanceof Error ? error.message : "Sign in to Zakura again.", false);
      });
      else hello(this.opts.token);
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
      this.awaitClose(socket, "Could not reach Zakura. Check the URL and channel configuration.");
    };
    socket.onclose = (event) => {
      if (!current()) return;
      const failure = channelCloseFailure(event.code);
      this.fail(failure.detail, failure.retry);
    };
  }

  private awaitClose(socket: WebSocket, detail: string) {
    const current = () => this.socket === socket && !this.closedByUser;
    if (!current() || this.closeTimer) return;
    // Browsers can report an error or expose CLOSING before dispatching close.
    // Preserve its auth/policy code; no older deadline may cut this wait short.
    this.clearSocketTimers();
    this.clearRequestTimers();
    this.setState("error", detail);
    if (current()) this.closeTimer = setTimeout(() => {
      if (current()) this.fail(detail, true);
    }, 1000);
  }

  private awaitClosingSocket(detail: string): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState < 2) return false;
    this.awaitClose(socket, detail);
    return true;
  }

  private failSocket(detail: string) {
    if (!this.awaitClosingSocket(detail)) this.fail(detail, true);
  }

  private fail(detail: string, retry: boolean) {
    this.cancelReconnect();
    this.releaseSocket();
    if (!retry) {
      this.closedByUser = true;
      this.stopObservingNetwork();
    }
    this.setState("error", detail);
    if (retry) this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.closedByUser || this.socket || this.reconnectTimer || this.network?.isOnline() === false) return;
    const delay = Math.min(this.opts.maxBackoffMs ?? 20_000, 1000 * 2 ** Math.min(this.attempt, 5));
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private cancelReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private resetBackoffWhenStable(socket: WebSocket) {
    if (!this.attempt || this.backoffResetTimer || this.socket !== socket || this.state !== "connected") return;
    // A ready followed by another failure is still part of the same outage.
    // Give heartbeats time to detect an unresponsive authenticated connection.
    this.backoffResetTimer = setTimeout(() => {
      if (this.socket !== socket || this.state !== "connected") return;
      this.backoffResetTimer = null;
      this.attempt = 0;
    }, BACKOFF_RESET_MS);
  }

  private startHeartbeat(socket: WebSocket) {
    const interval = this.opts.heartbeatMs ?? 25_000;
    if (interval <= 0 || this.heartbeatTimer || this.socket !== socket || this.state !== "connected") return;
    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== socket || this.state !== "connected" || this.pongTimer) return;
      this.pongTimer = setTimeout(() => {
        if (this.socket === socket) this.failSocket("Zakura stopped responding. Reconnecting…");
      }, this.opts.pongTimeoutMs ?? 10_000);
      if (!this.sendFrame({ type: "ping" })) this.failSocket("Connection lost. Reconnecting…");
    }, interval);
  }

  private handleFrame(raw: string) {
    const socket = this.socket;
    let frame;
    try { frame = decodeServerFrame(raw); } catch (error) {
      if (error instanceof UnsupportedChannelProtocolError) this.fail(error.message, false);
      else {
        const invalid = error instanceof InvalidChannelFrameError ? error : undefined;
        const agentId = invalid?.agentId;
        // Malformed data follows the same authentication/roster gate as valid
        // data. A revoked conversation's backfill cannot create global errors.
        if (agentId && (this.state !== "connected" || !this.roster.has(agentId))) return;
        if (this.state !== "connected" && invalid?.frameType && !["ready", "error"].includes(invalid.frameType)) return;
        this.emitter.emit({ type: "error", message: (error as Error).message, ...(agentId ? { agentId } : {}) });
      }
      return;
    }
    if (!frame) return;
    if (frame.type === "error") {
      if (frame.fatal) { this.fail(frame.message, false); return; }
      if (frame.agentId && (this.state !== "connected" || !this.roster.has(frame.agentId))) return;
      // Delivery and turn completion are separate. A correlated run failure
      // can follow its receipt, but an older failure cannot stop a newer turn.
      if (frame.clientMessageId && frame.agentId) {
        const messageKey = key(frame.agentId, frame.clientMessageId);
        const sent = this.sentMessages.get(messageKey);
        if (!sent) return;
        const turnEnded = frame.turnEnded === true && this.isLatestUserMessage(frame.agentId, messageKey);
        if (sent.echo && !turnEnded) return;
        this.acknowledge(frame.agentId, frame.clientMessageId);
        frame = { ...frame, turnEnded };
      }
      if (frame.agentId && (!frame.clientMessageId || frame.turnEnded)) {
        const agentId = frame.agentId;
        if (frame.turnEnded === true) this.endOutput(agentId);
        this.finishInterrupt(agentId);
        if (this.socket !== socket || this.closedByUser) return;
      }
      this.emitter.emit(frame);
      return;
    }
    if (frame.type === "ready") {
      if (this.state !== "connecting") return;
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
      this.updateRoster(frame.agents);
      // Subscribers can disconnect, replace the client, or put this same socket
      // into close grace. Only the still-pending handshake can become ready.
      if (this.socket !== socket || this.closedByUser || this.state !== "connecting") return;
      this.setState("connected", "zakurabot");
      if (socket) {
        this.resetBackoffWhenStable(socket);
        this.startHeartbeat(socket);
      }
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
        if (!this.acceptOutputIdentity(frame.message)) return;
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
      case "message": {
        const message = frame.message.role === "user" ? this.receiveReceipt(frame.message)
          : this.acceptOutputIdentity(frame.message) ? frame.message : null;
        if (message) this.emitter.emit({ type: "message", message });
        break;
      }
      case "typing":
        if (frame.active && this.roster.get(frame.agentId) === "offline") return;
        if (frame.active) this.liveTyping.add(frame.agentId);
        else {
          this.endOutput(frame.agentId);
          this.finishInterrupt(frame.agentId);
          if (this.socket !== socket || this.closedByUser) return;
        }
        this.emitter.emit(frame);
        break;
      case "tool_activity": {
        const messageKey = key(frame.agentId, frame.message.id);
        const active = frame.message.tool?.ok === undefined && !frame.message.tool?.interrupted;
        if (active && (this.roster.get(frame.agentId) === "offline" || this.activities.get(messageKey)?.active === false)) return;
        if (!this.acceptOutputIdentity(frame.message)) return;
        this.activities.set(messageKey, { agentId: frame.agentId, active });
        this.emitter.emit(frame);
        break;
      }
    }
  }

  private updateRoster(agents: Agent[]) {
    const socket = this.socket;
    this.roster = new Map(agents.map((agent) => [agent.id, agent.status]));
    for (const agentId of this.liveTyping) {
      if (!this.roster.has(agentId) || this.roster.get(agentId) === "offline") this.liveTyping.delete(agentId);
    }
    for (const output of [this.replies, this.activities]) {
      for (const [messageKey, item] of output) {
        if (!this.roster.has(item.agentId)) output.delete(messageKey);
        else if (this.roster.get(item.agentId) === "offline") item.active = false;
      }
    }
    for (const [messageKey, pending] of this.acknowledgements) {
      if (!this.roster.has(pending.agentId) || this.roster.get(pending.agentId) === "offline") {
        clearTimeout(pending.timer);
        this.acknowledgements.delete(messageKey);
      }
    }
    for (const [messageKey, sent] of this.sentMessages) {
      if (!this.roster.has(sent.agentId)) this.sentMessages.delete(messageKey);
    }
    for (const [messageKey, alias] of this.receiptAliases) {
      if (!this.roster.has(alias.agentId)) this.receiptAliases.delete(messageKey);
    }
    for (const [messageKey, identity] of this.outputIdentities) {
      if (!this.roster.has(identity.agentId)) this.outputIdentities.delete(messageKey);
    }
    const confirmedStops: [string, PendingInterrupt][] = [];
    for (const [agentId, pending] of this.interrupts) {
      if (!this.roster.has(agentId) || this.roster.get(agentId) === "offline") this.finishInterrupt(agentId, false);
      // A turn may end between the ready snapshot and the server's live
      // subscription. Its next idle roster is sufficient confirmation unless
      // this socket has observed explicit work that still needs a terminal event.
      else if (this.roster.get(agentId) === "idle" && !this.hasLiveWork(agentId)) confirmedStops.push([agentId, pending]);
    }
    this.emitter.emit({ type: "agents", agents });
    if (this.socket !== socket || this.closedByUser) return;
    for (const [agentId, pending] of confirmedStops) {
      if (this.interrupts.get(agentId) === pending && this.roster.get(agentId) === "idle" && !this.hasLiveWork(agentId)) {
        this.finishInterrupt(agentId);
        if (this.socket !== socket || this.closedByUser) return;
      }
    }
  }

  private hasLiveWork(agentId: string): boolean {
    if (this.liveTyping.has(agentId)) return true;
    for (const output of [this.replies, this.activities]) {
      for (const item of output.values()) if (item.agentId === agentId && item.active) return true;
    }
    return false;
  }

  private endOutput(agentId: string) {
    // A terminal event supersedes a busy roster snapshot. Keeping that old
    // status would let a stale Stop click invent work after the turn ended.
    if (this.roster.get(agentId) === "busy") this.roster.set(agentId, "idle");
    this.liveTyping.delete(agentId);
    for (const output of [this.replies, this.activities]) {
      for (const item of output.values()) if (item.agentId === agentId) item.active = false;
    }
  }

  private finishInterrupt(agentId: string, emit = true): boolean {
    const pending = this.interrupts.get(agentId);
    if (!pending) return false;
    if (pending.timer) clearTimeout(pending.timer);
    this.interrupts.delete(agentId);
    if (pending.timer && emit) this.emitter.emit({ type: "interrupt_pending", agentId, pending: false });
    return true;
  }

  private acknowledge(agentId: string, messageId: string): boolean {
    const messageKey = key(agentId, messageId);
    const pending = this.acknowledgements.get(messageKey);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.acknowledgements.delete(messageKey);
    return true;
  }

  private receiveReceipt(message: ChatMessage): ChatMessage | null {
    const serverKey = key(message.agentId, message.id);
    const alias = this.receiptAliases.get(serverKey);
    // A replay may omit clientMessageId after the server id was already mapped.
    // It must still validate and acknowledge the same original message.
    const clientMessageId = message.clientMessageId ?? alias?.clientMessageId ?? message.id;
    const messageKey = key(message.agentId, clientMessageId);
    const sent = this.sentMessages.get(messageKey);
    const idOwner = this.sentMessages.get(serverKey);
    const clientAlias = this.receiptAliases.get(messageKey);
    if (this.outputIdentities.has(serverKey) || this.outputIdentities.has(messageKey) ||
      (alias && alias.clientMessageId !== clientMessageId) ||
      (clientAlias && clientAlias.clientMessageId !== clientMessageId) ||
      (idOwner && idOwner !== sent) || (sent?.echo && sent.echo.id !== message.id)) {
      this.emitter.emit({ type: "error", agentId: message.agentId, turnEnded: false,
        message: "Zakura returned a message receipt with conflicting ids." });
      return null;
    }
    if (sent && sent.text !== message.text) {
      this.emitter.emit({ type: "error", agentId: message.agentId, turnEnded: false,
        message: "Zakura returned a message receipt with different text." });
      return null;
    }
    if (sent && attachmentIdentity(sent.attachments) !== attachmentIdentity(message.attachments)) {
      this.emitter.emit({ type: "error", agentId: message.agentId, turnEnded: false,
        message: "Zakura returned a message receipt with different attachments." });
      return null;
    }
    const receipt = { ...message, clientMessageId };
    this.rememberUserMessage(messageKey, { agentId: message.agentId, text: message.text!, attachments: message.attachments, createdAt: message.createdAt, echo: receipt });
    this.receiptAliases.set(serverKey, { agentId: message.agentId, clientMessageId });
    this.acknowledge(message.agentId, clientMessageId);
    return receipt;
  }

  private rememberUserMessage(messageKey: string, message: SentMessage) {
    this.sentMessages.set(messageKey, message);
    // Like the transcript, sort after every upsert and retain the previous
    // order for ties. A receipt can replace a local timestamp after backfill
    // has already moved ahead of it; original Map insertion order is stale.
    this.sentMessages = new Map([...this.sentMessages].sort((a, b) => a[1].createdAt - b[1].createdAt));
  }

  private isLatestUserMessage(agentId: string, messageKey: string): boolean {
    let latestKey: string | undefined;
    for (const [candidateKey, message] of this.sentMessages) {
      if (message.agentId === agentId) latestKey = candidateKey;
    }
    return latestKey === messageKey;
  }

  private acceptOutputIdentity(message: ChatMessage): boolean {
    const messageKey = key(message.agentId, message.id);
    const previous = this.outputIdentities.get(messageKey);
    if (this.sentMessages.has(messageKey) || this.receiptAliases.has(messageKey) ||
      (previous && (previous.role !== message.role || previous.kind !== message.kind))) {
      this.emitter.emit({ type: "error", agentId: message.agentId, turnEnded: false,
        message: "Zakura returned channel messages with conflicting ids." });
      return false;
    }
    this.outputIdentities.set(messageKey, { agentId: message.agentId, role: message.role, kind: message.kind });
    return true;
  }

  private sendFrame(frame: Record<string, unknown>): boolean {
    if (!this.socket || this.socket.readyState !== 1) return false;
    try { this.socket.send(JSON.stringify(frame)); return true; } catch { return false; }
  }

  private clearSocketTimers() {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    if (this.backoffResetTimer) clearTimeout(this.backoffResetTimer);
    this.handshakeTimer = this.heartbeatTimer = this.pongTimer = this.closeTimer = this.backoffResetTimer = null;
  }

  private clearRequestTimers() {
    for (const pending of this.acknowledgements.values()) clearTimeout(pending.timer);
    this.acknowledgements.clear();
    for (const pending of this.interrupts.values()) if (pending.timer) clearTimeout(pending.timer);
    this.interrupts.clear();
  }

  private releaseSocket() {
    this.clearSocketTimers();
    this.clearRequestTimers();
    for (const output of [this.replies, this.activities]) {
      for (const item of output.values()) item.active = false;
    }
    this.liveTyping.clear();
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
    this.stopObservingNetwork();
    this.cancelReconnect();
    this.releaseSocket();
    this.setState("disconnected");
  }

  async sendMessage(input: SendMessageInput): Promise<void> {
    if (this.state !== "connected") throw new Error("Not connected to Zakura.");
    this.requireAvailableAgent(input.agentId);
    const text = fileMessageText(input.text, input.attachments);
    const files = attachmentReferences(input.attachments);
    if ((!text && !files.length) || text.length > MAX_MESSAGE_LENGTH) throw new Error(`Use 1–${MAX_MESSAGE_LENGTH} characters or attach a file.`);
    const clientMessageId = input.clientMessageId ?? uid("user");
    if (!isChannelId(clientMessageId)) throw new Error("Invalid message id.");
    const messageKey = key(input.agentId, clientMessageId);
    if (this.outputIdentities.has(messageKey)) throw new Error("This message id is already used by another channel message. Send a new message instead.");
    const alias = this.receiptAliases.get(messageKey);
    if (alias && alias.clientMessageId !== clientMessageId) throw new Error("This message id is already used by another receipt. Send a new message instead.");
    const sent = this.sentMessages.get(messageKey);
    if (sent && sent.text !== text) throw new Error("A message id cannot be reused for different text. Send a new message instead.");
    if (sent && attachmentIdentity(sent.attachments) !== attachmentIdentity(input.attachments)) throw new Error("A message id cannot be reused for different attachments. Send a new message instead.");
    if (sent?.echo) {
      this.emitter.emit({ type: "message", message: sent.echo });
      return;
    }
    const previous = this.acknowledgements.get(messageKey);
    if (previous) return;
    const createdAt = sent?.createdAt ?? input.localCreatedAt ?? Date.now();
    if (!Number.isFinite(createdAt) || createdAt < 0 || createdAt > 8.64e15) throw new Error("Invalid local message timestamp.");
    this.rememberUserMessage(messageKey, { agentId: input.agentId, text, attachments: input.attachments, createdAt });
    const pending: PendingWrite = { agentId: input.agentId, text, timer: setTimeout(() => {
      if (this.acknowledgements.get(messageKey) !== pending) return;
      // A deadline may observe CLOSING before the browser dispatches error/close.
      if (this.awaitClosingSocket("Connection lost. Reconnecting…")) return;
      this.acknowledgements.delete(messageKey);
      this.emitter.emit({ type: "error", agentId: input.agentId, clientMessageId, turnEnded: false,
        message: "Delivery was not confirmed. Retry this message to check or resend it." });
    }, this.opts.acknowledgementTimeoutMs ?? 15_000) };
    this.acknowledgements.set(messageKey, pending);
    if (!this.sendFrame({ type: "send", agentId: input.agentId, clientMessageId, text, ...(files.length ? { attachments: files } : {}) })) {
      this.acknowledge(input.agentId, clientMessageId);
      this.failSocket("Connection lost. Reconnecting…");
      throw new Error("The message could not be written to the connection.");
    }
  }

  async interrupt(agentId: string): Promise<void> {
    if (this.state !== "connected") throw new Error("Could not stop the reply. Check the channel connection.");
    this.requireAvailableAgent(agentId);
    const socket = this.socket;
    // The UI can still have a Stop control mounted while a terminal frame is
    // being rendered. An idle conversation has nothing to cancel or await.
    // Closing sockets must still take the normal close-code preservation path.
    if (socket?.readyState === 1 && this.roster.get(agentId) !== "busy" && !this.hasLiveWork(agentId)) return;
    if (this.interrupts.get(agentId)?.timer) return;
    const pending = { timer: null as Timer | null };
    pending.timer = setTimeout(() => {
      if (this.interrupts.get(agentId) !== pending) return;
      if (this.awaitClosingSocket("Connection lost. Reconnecting…")) return;
      pending.timer = null;
      this.emitter.emit({ type: "interrupt_pending", agentId, pending: false });
      if (this.interrupts.get(agentId) === pending) {
        this.interrupts.delete(agentId);
        this.emitter.emit({ type: "error", agentId, turnEnded: false,
          message: "Stopping was not confirmed. The agent may still be working; try Stop again." });
      }
    }, this.opts.interruptTimeoutMs ?? 15_000);
    this.interrupts.set(agentId, pending);
    this.emitter.emit({ type: "interrupt_pending", agentId, pending: true });
    if (this.socket !== socket || this.closedByUser) throw new Error("The channel disconnected before the stop request was sent.");
    // A subscriber may observe turn completion or roster revocation before
    // this write. Never let that cancelled request reach a replacement turn.
    if (this.interrupts.get(agentId) !== pending) return;
    if (!this.sendFrame({ type: "interrupt", agentId })) {
      this.failSocket("Connection lost. Reconnecting…");
      throw new Error("Could not stop the reply. Check the channel connection.");
    }
  }

  private requireAvailableAgent(agentId: string) {
    if (!isChannelId(agentId) || !this.roster.has(agentId)) throw new Error("This agent is no longer available in the channel.");
    if (this.roster.get(agentId) === "offline") throw new Error("This agent is offline. Choose an available agent.");
  }
}
