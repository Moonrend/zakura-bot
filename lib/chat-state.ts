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
  /** Explicit live turn signals; pending delivery and roster snapshots are separate. */
  typing: Record<string, boolean>;
  interrupting: Record<string, boolean>;
  readThroughByAgent: Record<string, number>;
  connection: ChannelConnectionState;
  connectionDetail?: string;
  errors: ChannelError[];
  viewingThread: boolean;
}

export function emptyChatState(): ChatState {
  return { agents: [], selectedId: "", messagesByAgent: {}, draftsByAgent: {}, typing: {}, interrupting: {}, readThroughByAgent: {},
    connection: "disconnected", errors: [], viewingThread: false };
}

export type ChatAction = ChannelEvent
  | { type: "reset"; agents: Agent[]; messages: Record<string, ChatMessage[]> }
  | { type: "select"; agentId: string }
  | { type: "view"; visible: boolean }
  | { type: "draft"; agentId: string; text: string }
  | { type: "optimistic"; message: ChatMessage }
  | { type: "dismiss_error"; error: ChannelError };

function visibleContent(message: ChatMessage): boolean {
  return message.kind === "text" && !!(message.text?.trim() || message.card || message.attachments?.length || message.actions?.length);
}

function activeOutput(message: ChatMessage): boolean {
  return !!message.streaming || !!(message.tool && message.tool.ok === undefined && !message.tool.interrupted);
}

export function isAgentWorking(state: ChatState, agentId: string): boolean {
  const agent = state.agents.find((item) => item.id === agentId);
  return !!agent && agent.status !== "offline" && (agent.status === "busy" || !!state.typing[agentId] ||
    !!state.interrupting[agentId] || (state.messagesByAgent[agentId] ?? []).some(activeOutput));
}

function markRead(state: ChatState, agentId: string): ChatState {
  const readThrough = (state.messagesByAgent[agentId] ?? []).reduce((latest, message) =>
    message.role === "assistant" && visibleContent(message) ? Math.max(latest, message.createdAt) : latest,
  state.readThroughByAgent[agentId] ?? 0);
  return { ...state, readThroughByAgent: { ...state.readThroughByAgent, [agentId]: readThrough },
    agents: state.agents.map((agent) => agent.id === agentId ? { ...agent, unread: false } : agent) };
}

export function previewFromMessages(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!visibleContent(message)) continue;
    const text = messageContentPreview(message);
    if (text) return `${message.failed ? "Not sent · " : message.pending ? "Sending · " : message.role === "user" ? "You: " : ""}${text}`;
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
  const changed = !previous || ["text", "card", "attachments", "actions"].some(
    (field) => JSON.stringify(previous[field as keyof ChatMessage]) !== JSON.stringify(message[field as keyof ChatMessage]),
  );
  const viewing = state.viewingThread && state.selectedId === message.agentId;
  // History can interleave with live posts after ready. Older backfill should
  // not mark an already-read thread unread; updates to known streams still do.
  const backfill = !previous && message.createdAt < (state.readThroughByAgent[message.agentId] ?? 0);
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
      return next.viewingThread && next.selectedId ? markRead(next, next.selectedId) : next;
    }
    case "select":
      if (!state.agents.some((agent) => agent.id === action.agentId)) return state;
      return { ...(state.viewingThread ? markRead(state, action.agentId) : state), selectedId: action.agentId };
    case "view":
      return { ...(action.visible && state.selectedId ? markRead(state, state.selectedId) : state), viewingThread: action.visible };
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
  }
}
