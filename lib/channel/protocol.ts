/** Zakurabot v1 wire contract plus optional streaming/turn-ended extensions. */
import type { Agent, ChatMessage, MessageAttachment, MessageCard, MessageInteraction, MessageLink } from "../types";
import { MAX_MESSAGE_LENGTH, type ChannelEvent } from "./types";

export const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 1_000_000;

const TERMINAL_CLOSE_DETAILS = new Map<number, string>([
  [1002, "Channel protocol error (1002). Check that this app and Zakura use compatible versions."],
  [1003, "Zakura rejected the channel data type (1003). Check that this app and Zakura use compatible versions."],
  [1007, "Zakura rejected invalid channel data (1007). Check that this app and Zakura use compatible versions."],
  [1009, "Zakura rejected an oversized channel message (1009). Check the server's message limits before reconnecting."],
  [1008, "Channel access denied. Check your binding and token."],
  [4401, "Authentication failed. Check your token in Settings."],
  [4403, "Channel access denied. Check your binding and token."],
]);

/** Protocol/data rejection needs intervention; transport and service failures can retry. */
export function channelCloseFailure(code: number): { detail: string; retry: boolean } {
  const detail = TERMINAL_CLOSE_DETAILS.get(code);
  return detail ? { detail, retry: false } : { detail: `Connection closed (${code}). Reconnecting…`, retry: true };
}

export class UnsupportedChannelProtocolError extends Error {
  constructor() {
    super("This server uses an unsupported channel protocol.");
    this.name = "UnsupportedChannelProtocolError";
  }
}

/** Retain only validated envelope ids so invalid content stays conversation-scoped. */
export class InvalidChannelFrameError extends Error {
  constructor(readonly frameType?: string, readonly agentId?: string) {
    super("Invalid channel frame from Zakura.");
    this.name = "InvalidChannelFrameError";
  }
}

export type ServerFrame =
  | { type: "ready"; protocol: number; agents: Agent[] }
  | { type: "chat_reply"; message: ChatMessage }
  | Extract<ChannelEvent, { type: "agents" | "message" | "message_delta" | "message_done" | "tool_activity" | "typing" }>
  | (Extract<ChannelEvent, { type: "error" }> & { fatal?: boolean })
  | { type: "pong" };

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function requireValid(value: unknown): asserts value {
  if (!value) throw new InvalidChannelFrameError();
}
export function isChannelId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/.test(value) && value !== "prototype" && !Object.hasOwn(Object.prototype, value);
}
const id = isChannelId;
function oneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.includes(value as T);
}
function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}
function optionalBool(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}
function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 8.64e15;
}

function withinFrameLimit(raw: string): boolean {
  if (raw.length > MAX_FRAME_BYTES) return false;
  // A UTF-16 code unit needs at most three UTF-8 bytes. Most frames fit without
  // scanning; count larger frames without relying on Node or a TextEncoder polyfill.
  if (raw.length * 3 <= MAX_FRAME_BYTES) return true;
  let bytes = 0;
  for (const character of raw) {
    const code = character.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes > MAX_FRAME_BYTES) return false;
  }
  return true;
}

/** Resolve without the app's base URL so web and native open the same target. */
export function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** Used for all links received from a remote channel, including Markdown. */
export function isHttpUrl(value: unknown): value is string {
  return normalizeHttpUrl(value) !== null;
}

function httpUrl(value: unknown): string {
  const url = normalizeHttpUrl(value);
  requireValid(url);
  return url;
}

function links(value: unknown): MessageLink[] | undefined {
  if (value === undefined) return undefined;
  requireValid(Array.isArray(value));
  return value.map((item) => {
    requireValid(record(item) && typeof item.label === "string" && item.label.trim());
    requireValid(item.style === undefined || oneOf(item.style, ["primary", "danger", "default"]));
    return { label: item.label, url: httpUrl(item.url), style: item.style as MessageLink["style"] };
  });
}

function attachments(value: unknown): MessageAttachment[] | undefined {
  if (value === undefined) return undefined;
  requireValid(Array.isArray(value) && value.length <= 8);
  return value.map((item) => {
    // Zakura accepts paths and URLs. Its adapter must resolve paths before egress.
    if (typeof item === "string") return { url: httpUrl(item) };
    requireValid(record(item) && optionalString(item.name));
    requireValid(item.type === undefined || oneOf(item.type, ["image", "file", "audio", "video"]));
    requireValid(item.id === undefined || id(item.id));
    requireValid(optionalString(item.mime) && (item.size === undefined || (typeof item.size === "number" && Number.isSafeInteger(item.size) && item.size > 0)));
    return { url: httpUrl(item.url), name: item.name?.trim() || undefined, type: item.type as MessageAttachment["type"],
      ...(item.id === undefined ? {} : { id: item.id as string }), ...(item.mime === undefined ? {} : { mime: item.mime }),
      ...(item.size === undefined ? {} : { size: item.size as number }) };
  });
}

/** Uploaded IDs are the only attachment input accepted by the channel. */
export function attachmentReferences(files: MessageAttachment[] = []): { fileId: string }[] {
  if (files.length > 8 || files.some((file) => !id(file.id)) || new Set(files.map((file) => file.id)).size !== files.length) {
    throw new Error("Choose up to 8 uploaded files with distinct file IDs.");
  }
  return files.map((file) => ({ fileId: file.id! }));
}

function card(value: unknown): MessageCard | undefined {
  if (value === undefined) return undefined;
  requireValid(record(value));
  requireValid(optionalString(value.title) && optionalString(value.subtitle) && optionalString(value.text));
  const result: MessageCard = {
    title: value.title,
    subtitle: value.subtitle,
    text: value.text,
    imageUrl: value.imageUrl === undefined ? undefined : httpUrl(value.imageUrl),
    links: links(value.links),
  };
  if (value.fields !== undefined) {
    requireValid(Array.isArray(value.fields));
    result.fields = value.fields.map((field) => {
      requireValid(record(field) && typeof field.label === "string" && typeof field.value === "string");
      return { label: field.label, value: field.value };
    });
  }
  if (value.images !== undefined) {
    requireValid(Array.isArray(value.images));
    result.images = value.images.map((item) => {
      requireValid(record(item) && optionalString(item.alt));
      return { url: httpUrl(item.url), alt: item.alt?.trim() || undefined };
    });
  }
  if (value.table !== undefined) {
    requireValid(record(value.table));
    const { headers, rows } = value.table;
    // RemoteChannelSessionHandle cards can contain body rows without headers.
    requireValid(Array.isArray(headers) && headers.every((cell) => typeof cell === "string"));
    requireValid(Array.isArray(rows) && rows.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === "string")));
    if (headers.length || rows.length) result.table = { headers, rows };
  }
  // Empty card decoration must not discard usable text/files from the same
  // post. Validate every field above, then let the whole reply's content check
  // reject a post that has nothing visible at all.
  return (result.title?.trim() || result.subtitle?.trim() || result.text?.trim() || result.imageUrl ||
    result.fields?.some((field) => field.label.trim() || field.value.trim()) || result.images?.length ||
    result.table?.headers.some((cell) => cell.trim()) || result.table?.rows.some((row) => row.some((cell) => cell.trim())) || result.links?.length)
    ? result : undefined;
}

export function decodeInteraction(value: unknown): MessageInteraction {
  requireValid(record(value) && oneOf(value.type, ["approval", "question", "form"]) && id(value.requestId));
  requireValid(oneOf(value.status, ["pending", "answered", "cancelled", "skipped", "timeout", "resolved"]));
  const shortString = (item: unknown, max: number) => typeof item === "string" && item.length <= max;
  requireValid(shortString(value.title, 8000) && optionalBool(value.allowMultiple) && optionalBool(value.secret));
  requireValid(value.mode === undefined || oneOf(value.mode, ["sync", "async", "form", "url"]));
  requireValid(value.placeholder === undefined || shortString(value.placeholder, 2000));
  requireValid(value.expiresAt === undefined || value.expiresAt === null ||
    (typeof value.expiresAt === "string" && /^\d{4}-\d\d-\d\dT.*Z$/.test(value.expiresAt) && Number.isFinite(Date.parse(value.expiresAt))));
  const result: MessageInteraction = {
    type: value.type, requestId: value.requestId, status: value.status, title: value.title as string,
    allowMultiple: value.allowMultiple, secret: value.secret, mode: value.mode as MessageInteraction["mode"],
    expiresAt: value.expiresAt as MessageInteraction["expiresAt"], placeholder: value.placeholder as string | undefined,
    url: value.url === undefined ? undefined : httpUrl(value.url),
  };
  if (value.options !== undefined) {
    requireValid(Array.isArray(value.options) && value.options.length <= 32);
    const seen = new Set<string>();
    result.options = value.options.map((option) => {
      requireValid(record(option) && id(option.id) && !seen.has(option.id) && shortString(option.label, 2000) && option.label);
      requireValid(option.description === undefined || shortString(option.description, 4000));
      requireValid(option.kind === undefined || shortString(option.kind, 128));
      seen.add(option.id);
      return { id: option.id, label: option.label as string, description: option.description as string | undefined, kind: option.kind as string | undefined };
    });
  }
  if (value.fields !== undefined) {
    requireValid(Array.isArray(value.fields) && value.fields.length <= 32);
    const seen = new Set<string>();
    result.fields = value.fields.map((field) => {
      requireValid(record(field) && id(field.id) && !seen.has(field.id) && shortString(field.type, 128) && optionalBool(field.required));
      requireValid(field.title === undefined || shortString(field.title, 2000));
      requireValid(field.options === undefined || (Array.isArray(field.options) && field.options.length <= 32 &&
        field.options.every((option) => shortString(option, 2000) && option)));
      seen.add(field.id);
      return { id: field.id, type: field.type as string, title: field.title as string | undefined,
        required: field.required, options: field.options as string[] | undefined };
    });
  }
  return result;
}

function roster(value: unknown): Agent[] {
  requireValid(Array.isArray(value));
  const seen = new Set<string>();
  return value.map((item) => {
    requireValid(record(item) && id(item.id) && typeof item.name === "string" && item.name.trim());
    requireValid(!seen.has(item.id));
    seen.add(item.id);
    requireValid(oneOf(item.status, ["idle", "busy", "offline"]));
    requireValid(optionalString(item.title) && optionalString(item.preview) && optionalBool(item.unread));
    requireValid(item.color === undefined || (typeof item.color === "string" && /^#[\da-f]{6}$/i.test(item.color)));
    requireValid(item.bindingId === undefined || id(item.bindingId));
    requireValid(optionalString(item.description));
    let capabilities: Agent["capabilities"];
    if (item.capabilities !== undefined) {
      requireValid(record(item.capabilities) && typeof item.capabilities.files === "boolean" &&
        typeof item.capabilities.desktop === "boolean" && typeof item.capabilities.interactions === "boolean");
      capabilities = { files: item.capabilities.files, desktop: item.capabilities.desktop, interactions: item.capabilities.interactions };
    }
    return {
      id: item.id, name: item.name, title: item.title, preview: item.preview,
      status: item.status as Agent["status"], color: (item.color as string | undefined) ?? "#1084fe",
      unread: item.unread ?? false,
      ...(item.bindingId ? { bindingId: item.bindingId } : {}),
      ...(item.description ? { description: item.description } : {}),
      ...(capabilities ? { capabilities } : {}),
    };
  });
}

/** Unknown event types are ignored; malformed known events never reach the store. */
export function decodeServerFrame(raw: string): ServerFrame | null {
  requireValid(withinFrameLimit(raw));
  let frame: unknown;
  try { frame = JSON.parse(raw); } catch { throw new Error("Malformed JSON from Zakura."); }
  requireValid(record(frame) && typeof frame.type === "string");
  try { return decodeFrame(frame); }
  catch (error) {
    if (!(error instanceof InvalidChannelFrameError)) throw error;
    const agentId = frame.type === "message" ? record(frame.message) ? frame.message.agentId : undefined
      : ["chat_reply", "message_delta", "message_done", "tool_activity", "typing", "error"].includes(frame.type) ? frame.agentId : undefined;
    throw new InvalidChannelFrameError(frame.type, id(agentId) ? agentId : undefined);
  }
}

function decodeFrame(frame: RecordValue): ServerFrame | null {
  switch (frame.type) {
    case "ready":
      requireValid(typeof frame.protocol === "number" && Number.isSafeInteger(frame.protocol));
      // A different protocol may also change the roster schema. Report the
      // version mismatch before interpreting any of that version's data.
      if (frame.protocol !== PROTOCOL_VERSION) throw new UnsupportedChannelProtocolError();
      return { type: "ready", protocol: frame.protocol, agents: roster(frame.agents) };
    case "agents":
      return { type: "agents", agents: roster(frame.agents) };
    case "pong":
      return { type: "pong" };
    case "error":
      requireValid(typeof frame.message === "string" && frame.message.trim() && optionalBool(frame.fatal) && optionalBool(frame.turnEnded));
      requireValid(frame.agentId === undefined || id(frame.agentId));
      requireValid(frame.turnEnded !== true || id(frame.agentId));
      requireValid(frame.clientMessageId === undefined || (id(frame.clientMessageId) && id(frame.agentId)));
      return { type: "error", message: frame.message, agentId: frame.agentId as string | undefined,
        // v1 errors report failed operations. Only the explicit extension can
        // end a turn; an uncorrelated interrupt refusal may arrive in the next one.
        clientMessageId: frame.clientMessageId as string | undefined, fatal: frame.fatal, turnEnded: frame.turnEnded ?? false };
    case "chat_reply": {
      requireValid(id(frame.agentId) && id(frame.messageId) && timestamp(frame.createdAt) &&
        optionalBool(frame.streaming) && optionalBool(frame.interrupted) && !(frame.streaming && frame.interrupted));
      const payload = frame.payload;
      requireValid(record(payload) && optionalString(payload.text));
      requireValid(payload.format === undefined || oneOf(payload.format, ["markdown", "raw"]));
      requireValid(payload.kind === undefined || oneOf(payload.kind, ["markdown", "raw", "card"]));
      requireValid(payload.reply_to === undefined || id(payload.reply_to));
      const message: ChatMessage = {
        id: frame.messageId, agentId: frame.agentId, createdAt: frame.createdAt,
        role: "assistant", kind: "text", text: payload.text,
        format: (payload.kind ?? payload.format) === "raw" ? "raw" : "markdown",
        replyTo: payload.reply_to as string | undefined, streaming: frame.streaming ?? false,
        interrupted: frame.interrupted ?? false,
        attachments: attachments(payload.attachments), actions: links(payload.actions), card: card(payload.card),
        ...(payload.interaction === undefined ? {} : { interaction: decodeInteraction(payload.interaction) }),
      };
      requireValid(payload.kind !== "card" || payload.card !== undefined);
      requireValid(message.text?.trim() || message.streaming || message.interrupted || message.attachments?.length || message.actions?.length || message.card || message.interaction);
      return { type: "chat_reply", message };
    }
    case "message": {
      const m = frame.message;
      requireValid(record(m) && id(m.id) && id(m.agentId) && timestamp(m.createdAt));
      // Ordinary assistant/runtime events are not a source of visible replies.
      requireValid((m.role === "user" && m.kind === "text") || (m.role === "system" && m.kind === "system"));
      requireValid(typeof m.text === "string" && (m.clientMessageId === undefined || id(m.clientMessageId)));
      const files = m.role === "user" ? attachments(m.attachments) : undefined;
      requireValid(m.role !== "user" || ((m.text.trim().length > 0 || files?.length) && m.text.length <= MAX_MESSAGE_LENGTH));
      return { type: "message", message: {
        id: m.id, agentId: m.agentId, role: m.role, kind: m.kind, text: m.text, createdAt: m.createdAt,
        // A system notice cannot claim a user receipt's quote/correlation alias.
        clientMessageId: m.role === "user" ? m.clientMessageId as string | undefined : undefined, pending: false, failed: false,
        ...(files?.length ? { attachments: files } : {}),
      } };
    }
    case "tool_activity": {
      const m = frame.message;
      requireValid(id(frame.agentId) && record(m) && id(m.id) && m.agentId === frame.agentId && timestamp(m.createdAt));
      requireValid(m.role === "assistant" && m.kind === "activity" && record(m.tool));
      requireValid(typeof m.tool.name === "string" && m.tool.name.trim() && optionalBool(m.tool.ok) &&
        optionalString(m.tool.detail) && optionalBool(m.tool.interrupted));
      return { type: "tool_activity", agentId: frame.agentId, message: {
        id: m.id, agentId: frame.agentId, role: "assistant", kind: "activity", createdAt: m.createdAt,
        tool: { name: m.tool.name, ok: m.tool.ok, detail: m.tool.detail, interrupted: m.tool.interrupted },
      } };
    }
    case "message_delta":
      requireValid(id(frame.agentId) && id(frame.messageId) && typeof frame.delta === "string");
      return { type: "message_delta", agentId: frame.agentId, messageId: frame.messageId, delta: frame.delta };
    case "message_done":
      requireValid(id(frame.agentId) && id(frame.messageId) && optionalBool(frame.interrupted));
      return { type: "message_done", agentId: frame.agentId, messageId: frame.messageId, interrupted: frame.interrupted };
    case "typing":
      requireValid(id(frame.agentId) && typeof frame.active === "boolean");
      return { type: "typing", agentId: frame.agentId, active: frame.active };
    default:
      return null;
  }
}
