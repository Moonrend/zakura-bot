import type { Agent, ChatMessage } from "./types";
import type { ChannelConnectionState, ChannelEvent } from "./channel/types";

export interface ChannelError {
  message: string;
  agentId?: string;
  clientMessageId?: string;
}

export interface ChatState {
  agents: Agent[];
  selectedId: string;
  messagesByAgent: Record<string, ChatMessage[]>;
  draftsByAgent: Record<string, string>;
  typing: Record<string, boolean>;
  connection: ChannelConnectionState;
  connectionDetail?: string;
  errors: ChannelError[];
  viewingThread: boolean;
}

export function emptyChatState(): ChatState {
  return { agents: [], selectedId: "", messagesByAgent: {}, draftsByAgent: {}, typing: {},
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

export function previewFromMessages(messages: ChatMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!visibleContent(message)) continue;
    const text = message.text?.trim() || message.card?.title || message.card?.text ||
      message.attachments?.[0]?.name || (message.attachments?.length ? "Attachment" : undefined) ||
      message.actions?.[0]?.label || "Card";
    return `${message.failed ? "Not sent · " : message.role === "user" ? "You: " : ""}${text.replace(/\s+/g, " ")}`;
  }
}

/** Upserts also re-sort updated timestamps; echoes retain the optimistic key. */
function putMessage(state: ChatState, incoming: ChatMessage): ChatState {
  if (!state.agents.some((agent) => agent.id === incoming.agentId)) return state;
  const list = state.messagesByAgent[incoming.agentId] ?? [];
  const stableId = incoming.role === "user" ? incoming.clientMessageId ?? incoming.id : incoming.id;
  const previous = list.find((message) => message.id === stableId);
  const message: ChatMessage = { ...previous, ...incoming, id: stableId,
    serverId: incoming.id !== stableId ? incoming.id : previous?.serverId };
  const updated = (previous ? list.map((item) => item.id === stableId ? message : item) : [...list, message])
    .sort((a, b) => a.createdAt - b.createdAt);
  const changed = !previous || ["text", "card", "attachments", "actions"].some(
    (field) => JSON.stringify(previous[field as keyof ChatMessage]) !== JSON.stringify(message[field as keyof ChatMessage]),
  );
  const unread = message.role === "assistant" && visibleContent(message) && changed &&
    (!state.viewingThread || state.selectedId !== message.agentId);
  const preview = previewFromMessages(updated);
  return { ...state,
    messagesByAgent: { ...state.messagesByAgent, [message.agentId]: updated },
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
    agents: state.agents.map((agent) => agent.id === agentId && agent.status === "busy" ? { ...agent, status: "idle" } : agent),
    messagesByAgent: { ...state.messagesByAgent, [agentId]: settle(state.messagesByAgent[agentId] ?? []) },
  };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "reset":
      return { ...emptyChatState(), viewingThread: state.viewingThread, agents: action.agents,
        selectedId: action.agents[0]?.id ?? "", messagesByAgent: action.messages };
    case "select":
      if (!state.agents.some((agent) => agent.id === action.agentId)) return state;
      return { ...state, selectedId: action.agentId,
        agents: state.agents.map((agent) => agent.id === action.agentId ? { ...agent, unread: false } : agent) };
    case "view":
      return { ...state, viewingThread: action.visible,
        agents: state.agents.map((agent) => action.visible && agent.id === state.selectedId ? { ...agent, unread: false } : agent) };
    case "draft":
      return { ...state, draftsByAgent: { ...state.draftsByAgent, [action.agentId]: action.text } };
    case "dismiss_error":
      return { ...state, errors: state.errors.filter((error) => error !== action.error) };
    case "connection": {
      if (action.state === "connected") return { ...state, connection: action.state, connectionDetail: action.detail };
      const messagesByAgent = Object.fromEntries(Object.entries(state.messagesByAgent).map(([id, messages]) => [id, settle(messages, true)]));
      return { ...state, connection: action.state, connectionDetail: action.detail, typing: {}, messagesByAgent,
        agents: state.agents.map((agent) => ({ ...agent, status: agent.status === "busy" ? "idle" : agent.status,
          preview: previewFromMessages(messagesByAgent[agent.id] ?? []) ?? agent.preview })) };
    }
    case "agents": {
      const ids = new Set(action.agents.map((agent) => agent.id));
      const selectedId = ids.has(state.selectedId) ? state.selectedId : action.agents[0]?.id ?? "";
      const agents = action.agents.map((agent) => {
        const old = state.agents.find((item) => item.id === agent.id);
        return { ...agent, preview: previewFromMessages(state.messagesByAgent[agent.id] ?? []) ?? agent.preview,
          unread: state.viewingThread && agent.id === selectedId ? false : old?.unread ?? agent.unread };
      });
      return { ...state, agents, selectedId,
        messagesByAgent: Object.fromEntries(agents.map((agent) => [agent.id,
          agent.status === "offline" ? settle(state.messagesByAgent[agent.id] ?? [], true) : state.messagesByAgent[agent.id] ?? []])),
        draftsByAgent: Object.fromEntries(Object.entries(state.draftsByAgent).filter(([id]) => ids.has(id))),
        typing: Object.fromEntries(agents.map((agent) => [agent.id, agent.status === "busy"])),
        errors: state.errors.filter((error) => !error.agentId || ids.has(error.agentId)),
      };
    }
    case "optimistic": {
      const next = putMessage(state, { ...action.message, pending: true, failed: false });
      return { ...next, typing: { ...next.typing, [action.message.agentId]: true },
        errors: next.errors.filter((error) => error.agentId !== action.message.agentId),
        agents: next.agents.map((agent) => agent.id === action.message.agentId ? { ...agent, status: "busy" } : agent) };
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
      if (!state.agents.some((agent) => agent.id === action.agentId)) return state;
      if (!action.active) return endTurn(state, action.agentId);
      return { ...state, typing: { ...state.typing, [action.agentId]: true },
        agents: state.agents.map((agent) => agent.id === action.agentId ? { ...agent, status: "busy" } : agent) };
    }
    case "error": {
      if (action.agentId && !state.agents.some((agent) => agent.id === action.agentId)) return state;
      let next = action.agentId ? endTurn(state, action.agentId) : state;
      if (action.agentId && action.clientMessageId) {
        const message = (next.messagesByAgent[action.agentId] ?? []).find((item) => item.id === action.clientMessageId);
        if (message?.role === "user") next = putMessage(next, { ...message, pending: false, failed: true });
      }
      const error: ChannelError = { message: action.message, agentId: action.agentId, clientMessageId: action.clientMessageId };
      return { ...next, errors: [...next.errors.filter((item) => item.agentId !== action.agentId), error] };
    }
  }
}
