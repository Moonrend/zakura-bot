import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import {
  createChannelClient, createDemoMessages, uid, validateLiveSettings,
  type ChannelConnectionState, type ZakuraChannelClient,
} from "./channel";
import { DEMO_AGENTS } from "./channel/mock-client";
import { MAX_MESSAGE_LENGTH } from "./channel/types";
import { chatReducer, emptyChatState, isAgentWorking, previewFromMessages, type ChatAction, type ChannelError } from "./chat-state";
import { loadSettings, saveSettings } from "./settings";
import { DEFAULT_SETTINGS, type Agent, type AppSettings, type ChatMessage } from "./types";

export type { ChannelError } from "./chat-state";

type StoreValue = {
  agents: Agent[];
  selectedId: string;
  messagesByAgent: Record<string, ChatMessage[]>;
  draftsByAgent: Record<string, string>;
  typing: Record<string, boolean>;
  interrupting: Record<string, boolean>;
  settings: AppSettings;
  settingsReady: boolean;
  connection: ChannelConnectionState;
  connectionDetail?: string;
  transportLabel: string;
  lastError: ChannelError | null;
  sidebarOpen: boolean;
  selectAgent: (id: string) => void;
  setDraft: (agentId: string, text: string) => void;
  /** Clear only the submitted draft; never overwrite text typed while awaiting send. */
  clearDraft: (agentId: string, submitted: string) => void;
  send: (text: string, agentId?: string) => Promise<boolean>;
  retryMessage: (messageId: string) => Promise<boolean>;
  interrupt: () => Promise<void>;
  reconnect: () => Promise<void>;
  dismissError: () => void;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setSidebarOpen: (open: boolean) => void;
  setThreadVisible: (visible: boolean) => void;
};

const StoreContext = createContext<StoreValue | null>(null);

function demoTranscript(): Record<string, ChatMessage[]> {
  return {
    agent_zakura: createDemoMessages("agent_zakura"),
    agent_research: [{ id: "research_welcome", agentId: "agent_research", role: "assistant", kind: "text",
      text: "Your research workspace is ready. Try a question here, then switch conversations while the reply arrives.", createdAt: Date.now() - 10_000 }],
    agent_ops: [],
  };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  // Start empty on both the server and browser. Demo dates are created after hydration.
  const [state, setState] = useState(emptyChatState);
  const stateRef = useRef(state);
  const dispatch = useCallback((action: ChatAction) => {
    const next = chatReducer(stateRef.current, action);
    stateRef.current = next;
    setState(next);
  }, []);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  const [settingsReady, setSettingsReady] = useState(false);
  const [transportLabel, setTransportLabel] = useState("Mock");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const clientRef = useRef<ZakuraChannelClient | null>(null);
  const disposeRef = useRef<(() => void) | null>(null);
  const scopeRef = useRef<string | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const screenVisible = useRef(false);
  const foreground = useRef(true);

  const setThreadVisible = useCallback((visible: boolean) => {
    screenVisible.current = visible;
    dispatch({ type: "view", visible: visible && foreground.current });
  }, [dispatch]);

  useEffect(() => {
    const syncForeground = () => {
      foreground.current = Platform.OS === "web" && typeof document !== "undefined"
        ? document.visibilityState !== "hidden" : AppState.currentState === "active";
      dispatch({ type: "view", visible: screenVisible.current && foreground.current });
    };
    syncForeground();
    const subscription = AppState.addEventListener("change", syncForeground);
    if (Platform.OS === "web") document.addEventListener("visibilitychange", syncForeground);
    return () => {
      subscription.remove();
      if (Platform.OS === "web") document.removeEventListener("visibilitychange", syncForeground);
    };
  }, [dispatch]);

  const bootClient = useCallback((nextSettings: AppSettings) => {
    disposeRef.current?.();
    dispatch({ type: "connection", state: "disconnected" });
    const scope = nextSettings.useMockChannel ? "mock" : JSON.stringify([nextSettings.zakuraBaseUrl, nextSettings.authToken]);
    // A different server/token must never inherit another channel's roster or drafts.
    if (scope !== scopeRef.current) {
      const messages = nextSettings.useMockChannel ? demoTranscript() : {};
      const agents = nextSettings.useMockChannel ? DEMO_AGENTS.map((agent) => ({ ...agent,
        preview: previewFromMessages(messages[agent.id] ?? []) ?? agent.preview })) : [];
      dispatch({ type: "reset", agents, messages });
      scopeRef.current = scope;
    }
    const client = createChannelClient(nextSettings);
    clientRef.current = client;
    setTransportLabel(client.label);
    const unsubscribe = client.subscribe((event) => {
      if (clientRef.current === client) dispatch(event);
    });
    disposeRef.current = () => {
      unsubscribe();
      // Detach before disconnecting; no old client can mutate the new store.
      if (clientRef.current === client) clientRef.current = null;
      client.disconnect();
    };
    void client.connect().catch((error: unknown) => {
      if (clientRef.current === client) dispatch({ type: "connection", state: "error",
        detail: error instanceof Error ? error.message : "Could not connect to the channel." });
    });
  }, [dispatch]);

  useEffect(() => {
    let cancelled = false;
    void loadSettings().then((loaded) => {
      if (cancelled) return;
      settingsRef.current = loaded;
      setSettings(loaded);
      setSettingsReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    bootClient(settings);
    return () => { disposeRef.current?.(); disposeRef.current = null; };
  }, [settingsReady, settings, bootClient]);

  const selectAgent = useCallback((agentId: string) => dispatch({ type: "select", agentId }), [dispatch]);
  const setDraft = useCallback((agentId: string, text: string) => {
    if (stateRef.current.agents.some((agent) => agent.id === agentId)) dispatch({ type: "draft", agentId, text });
  }, [dispatch]);
  const clearDraft = useCallback((agentId: string, submitted: string) => {
    if (stateRef.current.draftsByAgent[agentId] === submitted) dispatch({ type: "draft", agentId, text: "" });
  }, [dispatch]);

  const deliver = useCallback(async (agentId: string, text: string, messageId: string): Promise<boolean> => {
    const current = stateRef.current;
    const client = clientRef.current;
    const agent = current.agents.find((item) => item.id === agentId);
    const trimmed = text.trim();
    if (!agent || !trimmed || trimmed.length > MAX_MESSAGE_LENGTH || isAgentWorking(current, agentId) ||
      current.messagesByAgent[agentId]?.some((message) => message.pending)) return false;
    if (agent.status === "offline" || client?.getConnectionState() !== "connected") {
      dispatch({ type: "error", agentId, message: "This conversation is offline. Reconnect or choose an available agent." });
      return false;
    }
    const previous = current.messagesByAgent[agentId]?.find((message) => message.id === messageId);
    dispatch({ type: "optimistic", message: { id: messageId, agentId, role: "user", kind: "text", text: trimmed,
      createdAt: previous?.createdAt ?? Date.now() } });
    try {
      await client.sendMessage({ agentId, text: trimmed, clientMessageId: messageId });
      return clientRef.current === client && client.getConnectionState() === "connected" &&
        stateRef.current.messagesByAgent[agentId]?.some((message) => message.id === messageId && !message.failed) === true;
    } catch (error) {
      if (clientRef.current === client) dispatch({ type: "error", agentId, clientMessageId: messageId,
        message: error instanceof Error ? error.message : "Could not send the message." });
      return false;
    }
  }, [dispatch]);

  const send = useCallback((text: string, agentId?: string) =>
    deliver(agentId ?? stateRef.current.selectedId, text, uid("user")), [deliver]);

  const retryMessage = useCallback(async (messageId: string) => {
    const agentId = stateRef.current.selectedId;
    const message = stateRef.current.messagesByAgent[agentId]?.find((item) => item.id === messageId);
    if (!message?.failed || message.role !== "user" || !message.text) return false;
    const draft = stateRef.current.draftsByAgent[agentId] ?? "";
    const ok = await deliver(agentId, message.text, messageId);
    if (ok && draft.trim() === message.text) clearDraft(agentId, draft);
    return ok;
  }, [deliver, clearDraft]);

  const interrupt = useCallback(async () => {
    const agentId = stateRef.current.selectedId;
    const client = clientRef.current;
    try {
      if (!client?.interrupt) throw new Error("This channel cannot stop a reply.");
      await client.interrupt(agentId);
    } catch (error) {
      if (clientRef.current === client) dispatch({ type: "error", agentId, turnEnded: false,
        message: error instanceof Error ? error.message : "Could not stop the reply." });
    }
  }, [dispatch]);

  const reconnect = useCallback(async () => bootClient(settingsRef.current), [bootClient]);
  const lastError = [...state.errors].reverse().find((error) => !error.agentId || error.agentId === state.selectedId) ?? null;
  const dismissError = useCallback(() => {
    const error = [...stateRef.current.errors].reverse().find((item) => !item.agentId || item.agentId === stateRef.current.selectedId);
    if (error) dispatch({ type: "dismiss_error", error });
  }, [dispatch]);

  const updateSettings = useCallback((patch: Partial<AppSettings>): Promise<void> => {
    const pending = saveQueue.current.catch(() => undefined).then(async () => {
      const next = { ...settingsRef.current, ...patch };
      next.zakuraBaseUrl = next.zakuraBaseUrl.trim();
      next.authToken = next.authToken.trim();
      if (!next.useMockChannel) {
        const problem = validateLiveSettings({ baseUrl: next.zakuraBaseUrl, token: next.authToken });
        if (problem) throw new Error(problem);
      }
      await saveSettings(next);
      if (JSON.stringify(next) !== JSON.stringify(settingsRef.current)) {
        settingsRef.current = next;
        setSettings(next);
      }
    });
    saveQueue.current = pending;
    return pending;
  }, []);

  const value = useMemo<StoreValue>(() => ({
    agents: state.agents, selectedId: state.selectedId, messagesByAgent: state.messagesByAgent,
    draftsByAgent: state.draftsByAgent,
    typing: Object.fromEntries(state.agents.map((agent) => [agent.id, isAgentWorking(state, agent.id)])),
    interrupting: state.interrupting, connection: state.connection,
    connectionDetail: state.connectionDetail, settings, settingsReady, transportLabel, lastError,
    sidebarOpen, selectAgent, setDraft, clearDraft, send, retryMessage, interrupt, reconnect,
    dismissError, updateSettings, setSidebarOpen, setThreadVisible,
  }), [state, settings, settingsReady, transportLabel, lastError, sidebarOpen, selectAgent, setDraft,
    clearDraft, send, retryMessage, interrupt, reconnect, dismissError, updateSettings, setThreadVisible]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useStore must be used within StoreProvider");
  return context;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function formatDay(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}) });
}
