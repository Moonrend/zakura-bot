import type { Agent, ChatMessage } from "./types";
import type { ChannelConnectionState, ChannelEvent } from "./channel/types";
import { messageContentPreview } from "./message-preview";
import { attachmentIdentity } from "./files";

export interface ChannelError {
  message: string;
  agentId?: string;
  clientMessageId?: string;
  /** A delivery receipt cannot resolve a failure of the subsequent agent turn. */
  turnEnded?: boolean;
}

export interface ChatState {
  agents: Agent[];
  selectedId: string;
  messagesByAgent: Record<string, ChatMessage[]>;
  draftsByAgent: Record<string, string>;
  /** Reactions per agent → message → reacting user → emoji (one per user per message). */
  reactionsByAgent: Record<string, Record<string, Record<string, string>>>;
  /** Explicit live turn signals; pending delivery and roster snapshots are separate. */
  typing: Record<string, boolean>;
  interrupting: Record<string, boolean>;
  readThroughByAgent: Record<string, number>;
  /** Assistant messages unread when each thread was last opened; frozen at open time. */
  unreadWindowByAgent: Record<string, UnreadWindow>;
  connection: ChannelConnectionState;
  connectionDetail?: string;
  errors: ChannelError[];
  viewingThread: boolean;
}

/** The span of messages that were unread at the moment a thread was opened. */
export interface UnreadWindow {
  /** Freshest assistant timestamp already read before the thread was opened. */
  from: number;
  /** Freshest assistant timestamp present when the thread was opened. */
  to: number;
}

export function emptyChatState(): ChatState {
  return { agents: [], selectedId: "", messagesByAgent: {}, draftsByAgent: {}, reactionsByAgent: {}, typing: {}, interrupting: {}, readThroughByAgent: {},
    unreadWindowByAgent: {}, connection: "disconnected", errors: [], viewingThread: false };
}

export type ChatAction = ChannelEvent
  | { type: "reset"; agents: Agent[]; messages: Record<string, ChatMessage[]> }
  | { type: "select"; agentId: string }
  | { type: "view"; visible: boolean }
  | { type: "draft"; agentId: string; text: string }
  | { type: "optimistic"; message: ChatMessage }
  | { type: "queue"; message: ChatMessage }
  | { type: "cancel_queued"; agentId: string; messageId: string }
  | { type: "flush"; agentId: string; messageId: string }
  | { type: "remove_message"; agentId: string; messageId: string }
  | { type: "setReactions"; agentId: string; messageId: string; reactions: Record<string, string> }
  | { type: "read"; agentId: string; unread: boolean }
  | { type: "dismiss_error"; error: ChannelError };

function visibleContent(message: ChatMessage): boolean {
  return message.kind === "text" && !!(message.text?.trim() || message.card || message.interaction || message.attachments?.length || message.actions?.length);
}

function activeOutput(message: ChatMessage): boolean {
  return !!message.streaming || !!(message.tool && message.tool.ok === undefined && !message.tool.interrupted);
}

/** Reactions are addressed by the server's message id; the store keeps the id the UI renders. */
function reactionKey(message: ChatMessage): string {
  return message.serverId ?? message.id;
}

function findReactionAgent(state: ChatState, messageId: string): string | undefined {
  for (const [agentId, messages] of Object.entries(state.messagesByAgent)) {
    if (messages.some((message) => message.id === messageId || message.serverId === messageId)) return agentId;
  }
  return undefined;
}

function withReactions(
  state: ChatState, agentId: string, messageId: string, reactions: Record<string, string> | undefined,
): ChatState {
  const forAgent = state.reactionsByAgent[agentId] ?? {};
  const next = { ...forAgent };
  if (reactions && Object.keys(reactions).length) next[messageId] = reactions;
  else delete next[messageId];
  return { ...state, reactionsByAgent: { ...state.reactionsByAgent, [agentId]: next } };
}

export function isAgentWorking(state: ChatState, agentId: string): boolean {
  const agent = state.agents.find((item) => item.id === agentId);
  return !!agent && agent.status !== "offline" && (agent.status === "busy" || !!state.typing[agentId] ||
    !!state.interrupting[agentId] || (state.messagesByAgent[agentId] ?? []).some(activeOutput));
}

function markRead(state: ChatState, agentId: string, captureWindow = false): ChatState {
  const previous = state.readThroughByAgent[agentId] ?? 0;
  const readThrough = (state.messagesByAgent[agentId] ?? []).reduce((latest, message) =>
    message.role === "assistant" && visibleContent(message) ? Math.max(latest, message.createdAt) : latest,
  previous);
  // Opening a thread freezes what was unread right then. Later arrivals must not
  // widen the window, so cap it at the freshest message present at open time.
  const unreadWindowByAgent = { ...state.unreadWindowByAgent };
  if (captureWindow) {
    if (previous > 0 && readThrough > previous) unreadWindowByAgent[agentId] = { from: previous, to: readThrough };
    else delete unreadWindowByAgent[agentId];
  }
  return { ...state, readThroughByAgent: { ...state.readThroughByAgent, [agentId]: readThrough },
    unreadWindowByAgent,
    agents: state.agents.map((agent) => agent.id === agentId ? { ...agent, unread: false } : agent) };
}

export function previewFromMessages(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!visibleContent(message)) continue;
    const text = messageContentPreview(message);
    if (text) return `${message.failed ? "Not sent · " : message.queued ? "Will send · " : message.pending ? "Sending · " : message.role === "user" ? "You: " : ""}${text}`;
  }
}

/** Upserts also re-sort updated timestamps; echoes retain the optimistic key. */
function putMessage(state: ChatState, incoming: ChatMessage): ChatState {
  if (!state.agents.some((agent) => agent.id === incoming.agentId)) return state;
  const list = state.messagesByAgent[incoming.agentId] ?? [];
  const incomingId = incoming.role === "user" ? incoming.clientMessageId ?? incoming.id : incoming.id;
  const ownsId = (message: ChatMessage, id: string) =>
    message.id === id || message.serverId === id || message.clientMessageId === id;
  const byClientId = list.find((message) => ownsId(message, incomingId));
  const byServerId = list.find((message) => ownsId(message, incoming.id));
  if (byClientId && byServerId && byClientId !== byServerId) return state;
  const previous = byClientId ?? byServerId;
  // Message ids identify one role and content kind for the lifetime of a thread.
  if (previous && (previous.role !== incoming.role || previous.kind !== incoming.kind)) return state;
  if (previous?.interaction && incoming.interaction &&
    (previous.interaction.requestId !== incoming.interaction.requestId || previous.interaction.type !== incoming.interaction.type ||
      (previous.interaction.status !== "pending" && incoming.interaction.status === "pending"))) return state;
  // Keep receipt identity as well as text immutable across client replacement.
  // A replay without correlation may use the known server id as its client id;
  // accept that fallback without replacing the original optimistic alias.
  if (previous?.role === "user") {
    const serverId = previous.serverId ?? (!previous.pending && !previous.failed ? previous.id : undefined);
    if (previous.text !== incoming.text || attachmentIdentity(previous.attachments) !== attachmentIdentity(incoming.attachments) ||
      (serverId && incoming.id !== serverId && incoming.id !== previous.id) ||
      (incoming.clientMessageId && !ownsId(previous, incoming.clientMessageId))) return state;
  }
  // A replacement client can replay a stream announcement. Keep received text
  // and its terminal state until a complete snapshot restores the old reply.
  if (previous && !previous.streaming && incoming.streaming) return state;
  // A replayed start must not resurrect a completed or disconnected tool chip.
  if (previous?.tool && !activeOutput(previous) && activeOutput(incoming)) return state;
  const stableId = previous?.id ?? incomingId;
  const message: ChatMessage = { ...previous, ...incoming, id: stableId,
    clientMessageId: previous?.clientMessageId ?? incoming.clientMessageId,
    serverId: incoming.id !== stableId ? incoming.id : previous?.serverId };
  const updated = (previous ? list.map((item) => item.id === stableId ? message : item) : [...list, message])
    .sort((a, b) => a.createdAt - b.createdAt);
  const changed = !previous || ["text", "card", "interaction", "attachments", "actions"].some(
    (field) => JSON.stringify(previous[field as keyof ChatMessage]) !== JSON.stringify(message[field as keyof ChatMessage]),
  );
  const viewing = state.viewingThread && state.selectedId === message.agentId;
  // History can interleave with live posts after ready. Older backfill should
  // not mark an already-read thread unread; updates to known streams still do.
  // A server page prepends below the oldest loaded row, which is never a live post.
  const oldestLoaded = list[0];
  const backfill = !previous && (message.createdAt < (state.readThroughByAgent[message.agentId] ?? 0) ||
    (oldestLoaded !== undefined && message.createdAt < oldestLoaded.createdAt));
  const unread = message.role === "assistant" && visibleContent(message) && changed && !backfill && !viewing;
  const preview = previewFromMessages(updated);
  return { ...state,
    messagesByAgent: { ...state.messagesByAgent, [message.agentId]: updated },
    readThroughByAgent: viewing && message.role === "assistant" && visibleContent(message)
      ? { ...state.readThroughByAgent, [message.agentId]: Math.max(state.readThroughByAgent[message.agentId] ?? 0, message.createdAt) }
      : state.readThroughByAgent,
    errors: message.role === "user" && !message.pending && !message.failed
      ? state.errors.filter((error) => error.turnEnded || error.agentId !== message.agentId ||
        ![message.id, message.clientMessageId, message.serverId].some((id) => id !== undefined && id === error.clientMessageId))
      : state.errors,
    agents: state.agents.map((agent) => agent.id === message.agentId
      ? { ...agent, preview: preview ?? agent.preview, unread: agent.unread || unread } : agent),
  };
}

/** Never leave a spinner running after its channel or turn has ended. */
function settle(messages: ChatMessage[], deliveryLost = false): ChatMessage[] {
  return messages.map((message) => {
    if (message.streaming) return { ...message, streaming: false, interrupted: true };
    if (message.kind === "activity" && message.tool?.ok === undefined && !message.tool?.interrupted) {
      return { ...message, tool: message.tool ? { ...message.tool, interrupted: true } : undefined };
    }
    if (deliveryLost && message.pending) return { ...message, pending: false, failed: true };
    return message;
  });
}

function endTurn(state: ChatState, agentId: string): ChatState {
  return { ...state,
    typing: { ...state.typing, [agentId]: false },
    interrupting: { ...state.interrupting, [agentId]: false },
    agents: state.agents.map((agent) => agent.id === agentId && agent.status === "busy" ? { ...agent, status: "idle" } : agent),
    messagesByAgent: { ...state.messagesByAgent, [agentId]: settle(state.messagesByAgent[agentId] ?? []) },
  };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "reset": {
      const next = { ...emptyChatState(), viewingThread: state.viewingThread, agents: action.agents,
        selectedId: action.agents[0]?.id ?? "", messagesByAgent: action.messages };
      return next.viewingThread && next.selectedId ? markRead(next, next.selectedId, true) : next;
    }
    case "select":
      if (!state.agents.some((agent) => agent.id === action.agentId)) return state;
      return { ...(state.viewingThread
        ? markRead(state, action.agentId, action.agentId !== state.selectedId) : state), selectedId: action.agentId };
    case "view":
      return { ...(action.visible && state.selectedId ? markRead(state, state.selectedId, !state.viewingThread) : state),
        viewingThread: action.visible };
    case "draft":
      if (!state.agents.some((agent) => agent.id === action.agentId)) return state;
      return { ...state, draftsByAgent: { ...state.draftsByAgent, [action.agentId]: action.text } };
    case "dismiss_error":
      return { ...state, errors: state.errors.filter((error) => error !== action.error) };
    case "connection": {
      if (action.state === "connected") return { ...state, connection: action.state, connectionDetail: action.detail,
        // A fresh authenticated connection resolves channel diagnostics, such
        // as the gateway's temporary error before a 1011 close. It cannot
        // confirm a failed send or recover an agent's failed run.
        errors: state.connection === "connected" ? state.errors : state.errors.filter((error) => error.agentId !== undefined) };
      const messagesByAgent = Object.fromEntries(Object.entries(state.messagesByAgent).map(([id, messages]) => [id, settle(messages, true)]));
      return { ...state, connection: action.state, connectionDetail: action.detail, typing: {}, interrupting: {}, messagesByAgent,
        agents: state.agents.map((agent) => ({ ...agent, status: agent.status === "busy" ? "idle" : agent.status,
          preview: previewFromMessages(messagesByAgent[agent.id] ?? []) ?? agent.preview })) };
    }
    case "agents": {
      const ids = new Set(action.agents.map((agent) => agent.id));
      const selectedId = ids.has(state.selectedId) ? state.selectedId : action.agents[0]?.id ?? "";
      const messagesByAgent = Object.fromEntries(action.agents.map((agent) => [agent.id,
        agent.status === "offline" ? settle(state.messagesByAgent[agent.id] ?? [], true) : state.messagesByAgent[agent.id] ?? []]));
      const agents = action.agents.map((agent) => {
        const old = state.agents.find((item) => item.id === agent.id);
        const localWork = state.connection === "connected" && state.typing[agent.id];
        return { ...agent, status: agent.status !== "offline" && localWork ? "busy" as const : agent.status,
          preview: previewFromMessages(messagesByAgent[agent.id]) ?? agent.preview,
          unread: state.viewingThread && agent.id === selectedId ? false : old?.unread ?? agent.unread };
      });
      const next = { ...state, agents, selectedId, messagesByAgent,
        draftsByAgent: Object.fromEntries(Object.entries(state.draftsByAgent).filter(([id]) => ids.has(id))),
        // A busy roster snapshot is not a live typing pulse. A later idle
        // snapshot can recover a turn whose ending event was missed offline.
        typing: Object.fromEntries(agents.map((agent) => [agent.id, agent.status !== "offline" && !!state.typing[agent.id]])),
        interrupting: Object.fromEntries(agents.map((agent) => [agent.id, agent.status !== "offline" && !!state.interrupting[agent.id]])),
        readThroughByAgent: Object.fromEntries(Object.entries(state.readThroughByAgent).filter(([id]) => ids.has(id))),
        unreadWindowByAgent: Object.fromEntries(Object.entries(state.unreadWindowByAgent).filter(([id]) => ids.has(id))),
        reactionsByAgent: Object.fromEntries(Object.entries(state.reactionsByAgent).filter(([id]) => ids.has(id))),
        errors: state.errors.filter((error) => !error.agentId || ids.has(error.agentId)),
      };
      return next.viewingThread && selectedId ? markRead(next, selectedId) : next;
    }
    case "optimistic": {
      if (!state.agents.some((agent) => agent.id === action.message.agentId)) return state;
      const previous = state.messagesByAgent[action.message.agentId]?.find((message) => message.id === action.message.id);
      const next = putMessage(state, { ...action.message, pending: true, failed: false });
      // A retry can return only a receipt. It cannot resolve a failed run or
      // another message's delivery; a new message starts recovery.
      const aliases = previous ? [previous.id, previous.clientMessageId, previous.serverId] : [];
      return { ...next, errors: next.errors.filter((error) => error.agentId !== action.message.agentId ||
        (previous && (error.turnEnded || error.clientMessageId === undefined || !aliases.includes(error.clientMessageId)))) };
    }
    case "queue": {
      if (!state.agents.some((agent) => agent.id === action.message.agentId)) return state;
      return putMessage(state, { ...action.message, queued: true, pending: false, failed: false });
    }
    case "cancel_queued": {
      const list = state.messagesByAgent[action.agentId] ?? [];
      const message = list.find((item) => item.role === "user" && item.queued === true &&
        (item.id === action.messageId || item.clientMessageId === action.messageId));
      if (!message) return state;
      const updated = list.filter((item) => item !== message);
      return { ...state,
        messagesByAgent: { ...state.messagesByAgent, [action.agentId]: updated },
        agents: state.agents.map((agent) => agent.id === action.agentId
          ? { ...agent, preview: previewFromMessages(updated) } : agent),
      };
    }
    case "flush": {
      const message = (state.messagesByAgent[action.agentId] ?? []).find((item) => item.role === "user" && item.queued === true &&
        (item.id === action.messageId || item.clientMessageId === action.messageId));
      if (!message) return state;
      return putMessage(state, { ...message, queued: false, pending: true });
    }
    case "remove_message": {
      const list = state.messagesByAgent[action.agentId] ?? [];
      const message = list.find((item) => item.role === "user" && item.failed === true &&
        (item.id === action.messageId || item.clientMessageId === action.messageId || item.serverId === action.messageId));
      if (!message) return state;
      const updated = list.filter((item) => item !== message);
      const aliases = [message.id, message.clientMessageId, message.serverId];
      return { ...state,
        messagesByAgent: { ...state.messagesByAgent, [action.agentId]: updated },
        errors: state.errors.filter((error) => error.turnEnded || error.agentId !== action.agentId ||
          error.clientMessageId === undefined || !aliases.some((id) => id !== undefined && id === error.clientMessageId)),
        agents: state.agents.map((agent) => agent.id === action.agentId
          ? { ...agent, preview: previewFromMessages(updated) } : agent),
      };
    }
    case "reaction": {
      const agentId = findReactionAgent(state, action.messageId);
      if (!agentId) return state;
      const message = (state.messagesByAgent[agentId] ?? []).find((item) =>
        item.id === action.messageId || item.serverId === action.messageId);
      if (!message) return state;
      const key = reactionKey(message);
      const current = state.reactionsByAgent[agentId]?.[key] ?? {};
      const next = { ...current };
      if (action.op === "add") next[action.userId] = action.emoji;
      // A stale removal must not clear a newer replacement for the same user.
      else if (current[action.userId] === action.emoji) delete next[action.userId];
      else return state;
      return withReactions(state, agentId, key, next);
    }
    case "setReactions": {
      if (!state.agents.some((agent) => agent.id === action.agentId)) return state;
      return withReactions(state, action.agentId, action.messageId, action.reactions);
    }
    case "message":
      return putMessage(state, action.message.role === "user" ? { ...action.message, pending: false, failed: false } : action.message);
    case "tool_activity":
      return putMessage(state, action.message);
    case "message_delta": {
      const message = (state.messagesByAgent[action.agentId] ?? []).find((item) => item.id === action.messageId);
      if (!message || message.role !== "assistant" || !message.streaming) return state;
      return putMessage(state, { ...message, text: (message.text ?? "") + action.delta });
    }
    case "message_done": {
      const message = (state.messagesByAgent[action.agentId] ?? []).find((item) => item.id === action.messageId);
      if (!message || !message.streaming) return state;
      // A message finishing does not finish a turn: chat_reply may run repeatedly.
      return putMessage(state, { ...message, streaming: false, interrupted: action.interrupted ?? false });
    }
    case "typing": {
      const agent = state.agents.find((agent) => agent.id === action.agentId);
      if (!agent || (action.active && agent.status === "offline")) return state;
      if (!action.active) return endTurn(state, action.agentId);
      return { ...state, typing: { ...state.typing, [action.agentId]: true },
        agents: state.agents.map((agent) => agent.id === action.agentId ? { ...agent, status: "busy" } : agent) };
    }
    case "interrupt_pending":
      if (!state.agents.some((agent) => agent.id === action.agentId && agent.status !== "offline")) return state;
      return { ...state, interrupting: { ...state.interrupting, [action.agentId]: action.pending } };
    case "error": {
      if (action.agentId && !state.agents.some((agent) => agent.id === action.agentId)) return state;
      let next = state;
      let turnEnded = action.turnEnded === true;
      if (action.agentId && action.clientMessageId) {
        const messages = state.messagesByAgent[action.agentId] ?? [];
        const message = messages.find((item) => item.id === action.clientMessageId || item.serverId === action.clientMessageId || item.clientMessageId === action.clientMessageId);
        if (message?.role !== "user") return state;
        const latestUser = [...messages].reverse().find((item) => item.role === "user");
        turnEnded = turnEnded && latestUser?.id === message.id;
        const undelivered = message.pending || message.failed;
        if (!undelivered && !turnEnded) return state;
        // Rejection or an absent receipt says nothing about an agent that may
        // already be working, including the interval before its first output.
        if (turnEnded) next = endTurn(state, action.agentId);
        if (undelivered) next = putMessage(next, { ...message, pending: false, failed: true });
      } else if (action.agentId && turnEnded) next = endTurn(state, action.agentId);
      const error: ChannelError = { message: action.message, agentId: action.agentId, clientMessageId: action.clientMessageId,
        ...(turnEnded ? { turnEnded: true } : {}) };
      return { ...next, errors: [...next.errors.filter((item) => item.agentId !== error.agentId ||
        item.clientMessageId !== error.clientMessageId || !!item.turnEnded !== turnEnded), error] };
    }
    case "read": {
      if (!state.agents.some((agent) => agent.id === action.agentId)) return state;
      if (action.unread) return { ...state, agents: state.agents.map((agent) => agent.id === action.agentId ? { ...agent, unread: true } : agent) };
      return markRead(state, action.agentId);
    }
  }
}

const DAY_MS = 86_400_000;

function startOfDay(ts: number): number {
  const date = new Date(ts);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Mirrors lib/store's formatDay without importing its React Native module. */
export function dividerDayLabel(ts: number, now = Date.now()): string {
  const date = new Date(ts);
  const diffDays = Math.round((startOfDay(now) - startOfDay(ts)) / DAY_MS);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric",
    ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" as const } : {}) });
}

export type TranscriptRow =
  | { kind: "day"; key: string; label: string }
  | { kind: "unread"; key: string; label: string }
  | { kind: "msg"; message: ChatMessage; grouped: boolean };

/**
 * Pure render projection: date dividers on every local calendar-day change (including the top of
 * the loaded page) and one unread divider above the first unread assistant message. Backfilled
 * older pages only shift the message list; positions stay a function of timestamps + window.
 */
export function buildTranscriptRows(
  messages: ChatMessage[],
  unread?: UnreadWindow | null,
  now = Date.now(),
): TranscriptRow[] {
  let firstUnread = -1;
  let unreadCount = 0;
  if (unread && unread.from > 0 && unread.to > unread.from) {
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      if (message.role !== "assistant" || !visibleContent(message)) continue;
      if (message.createdAt <= unread.from || message.createdAt > unread.to) continue;
      if (firstUnread < 0) firstUnread = index;
      unreadCount++;
    }
  }
  const rows: TranscriptRow[] = [];
  let lastDay = "";
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    const day = new Date(message.createdAt).toDateString();
    if (day !== lastDay) {
      rows.push({ kind: "day", key: `day_${message.id}`, label: dividerDayLabel(message.createdAt, now) });
      lastDay = day;
    }
    if (index === firstUnread) rows.push({ kind: "unread", key: `unread_${message.id}`,
      label: `${unreadCount} new message${unreadCount === 1 ? "" : "s"}` });
    const next = messages[index + 1];
    const grouped = !!next && next.kind === "text" && message.kind === "text" && next.role === message.role &&
      new Date(next.createdAt).toDateString() === day && next.createdAt - message.createdAt < 60_000;
    rows.push({ kind: "msg", message, grouped });
  }
  return rows;
}
