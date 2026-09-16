import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createChannelClient,
  createDemoMessages,
  uid,
  type ChannelConnectionState,
  type ChannelEvent,
  type ZakuraChannelClient,
} from "./channel";
import { loadSettings, saveSettings } from "./settings";
import {
  DEFAULT_SETTINGS,
  type Agent,
  type AppSettings,
  type ChatMessage,
} from "./types";

const DEMO_AGENTS: Agent[] = [
  {
    id: "agent_zakura",
    name: "Zakura",
    title: "Platform agent",
    color: "#1084fe",
    status: "idle",
    unread: false,
    preview: "Welcome to Zakura Bot…",
  },
  {
    id: "agent_research",
    name: "Research",
    title: "Briefs & digests",
    color: "#38d591",
    status: "idle",
    unread: true,
    preview: "Weekly competitor brief ready",
  },
  {
    id: "agent_ops",
    name: "Ops",
    title: "Routines",
    color: "#ff9800",
    status: "offline",
    unread: false,
    preview: "No messages yet",
  },
];

export interface ChannelError {
  id: string;
  message: string;
  agentId?: string;
  at: number;
}

type StoreValue = {
  agents: Agent[];
  selectedId: string;
  messagesByAgent: Record<string, ChatMessage[]>;
  typing: Record<string, boolean>;
  settings: AppSettings;
  settingsReady: boolean;
  connection: ChannelConnectionState;
  connectionDetail?: string;
  transportLabel: string;
  lastError: ChannelError | null;
  sidebarOpen: boolean;
  selectAgent: (id: string) => void;
  /** Resolves true when the message was accepted by the channel. */
  send: (text: string) => Promise<boolean>;
  /** Re-send a message that previously failed. */
  retryMessage: (messageId: string) => Promise<boolean>;
  interrupt: () => Promise<void>;
  reconnect: () => Promise<void>;
  dismissError: () => void;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setSidebarOpen: (open: boolean) => void;
};

const StoreContext = createContext<StoreValue | null>(null);

function previewOf(m: ChatMessage): string | undefined {
  if (m.kind === "activity" && m.tool) return `⚙ ${m.tool.name}`;
  if (m.text) return m.text.replace(/\s+/g, " ").trim();
  return undefined;
}

function previewFromMessages(msgs: ChatMessage[]): string | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const p = previewOf(msgs[i]);
    if (p) return p;
  }
  return undefined;
}

/** Insert or merge a message, keeping the list ordered by createdAt (stable for ties). */
function upsertInto(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const idx = list.findIndex((m) => m.id === message.id);
  if (idx >= 0) {
    return list.map((m, i) => (i === idx ? { ...m, ...message } : m));
  }
  // Fast path: newest message goes to the end (the common case).
  const last = list[list.length - 1];
  if (!last || last.createdAt <= message.createdAt) return [...list, message];
  const next = [...list];
  let pos = next.length;
  while (pos > 0 && next[pos - 1].createdAt > message.createdAt) pos--;
  next.splice(pos, 0, message);
  return next;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [agents, setAgents] = useState<Agent[]>(DEMO_AGENTS);
  const [selectedId, setSelectedId] = useState(DEMO_AGENTS[0].id);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const [messagesByAgent, setMessagesByAgent] = useState<Record<string, ChatMessage[]>>({
    agent_zakura: createDemoMessages("agent_zakura"),
    agent_research: [
      {
        id: "r1",
        agentId: "agent_research",
        role: "assistant",
        kind: "text",
        text: "Research agent is a placeholder roster entry. Wire it to a Zakura agent id after the zakurabot channel lands.",
        createdAt: Date.now() - 10_000,
      },
    ],
    agent_ops: [],
  });
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [connection, setConnection] = useState<ChannelConnectionState>("disconnected");
  const [connectionDetail, setConnectionDetail] = useState<string | undefined>();
  const [transportLabel, setTransportLabel] = useState("Mock");
  const [lastError, setLastError] = useState<ChannelError | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const clientRef = useRef<ZakuraChannelClient | null>(null);

  const upsertMessage = useCallback((message: ChatMessage) => {
    setMessagesByAgent((prev) => ({
      ...prev,
      [message.agentId]: upsertInto(prev[message.agentId] ?? [], message),
    }));
    setAgents((prev) =>
      prev.map((a) => {
        if (a.id !== message.agentId) return a;
        const preview = previewOf(message) ?? a.preview;
        // Only assistant output marks a thread unread, and only when not focused.
        const unread =
          message.role === "assistant" && a.id !== selectedRef.current ? true : a.unread;
        return { ...a, preview, unread, status: a.status === "offline" ? "idle" : a.status };
      }),
    );
  }, []);

  const handleEvent = useCallback(
    (event: ChannelEvent) => {
      switch (event.type) {
        case "connection":
          setConnection(event.state);
          setConnectionDetail(event.detail);
          if (event.state === "connected") setLastError(null);
          break;
        case "message":
        case "tool_activity":
          upsertMessage(event.message);
          break;
        case "message_delta":
          setMessagesByAgent((prev) => {
            const list = prev[event.agentId] ?? [];
            return {
              ...prev,
              [event.agentId]: list.map((m) =>
                m.id === event.messageId
                  ? { ...m, text: (m.text ?? "") + event.delta, streaming: true }
                  : m,
              ),
            };
          });
          break;
        case "message_done":
          setMessagesByAgent((prev) => {
            const list = prev[event.agentId] ?? [];
            const updated = list.map((m) =>
              m.id === event.messageId
                ? { ...m, streaming: false, interrupted: event.interrupted || undefined }
                : m,
            );
            const preview = previewFromMessages(updated);
            setAgents((ags) =>
              ags.map((a) => (a.id === event.agentId ? { ...a, preview: preview ?? a.preview } : a)),
            );
            return { ...prev, [event.agentId]: updated };
          });
          break;
        case "typing":
          setTyping((t) => ({ ...t, [event.agentId]: event.active }));
          setAgents((ags) =>
            ags.map((a) =>
              a.id === event.agentId ? { ...a, status: event.active ? "busy" : "idle" } : a,
            ),
          );
          break;
        case "error":
          setLastError({ id: uid("err"), message: event.message, agentId: event.agentId, at: Date.now() });
          break;
      }
    },
    [upsertMessage],
  );
  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;

  /** Tear down the current client and build one from `settings`. */
  const bootClient = useCallback(async (s: AppSettings) => {
    clientRef.current?.disconnect();
    setTyping({});
    setAgents((ags) => ags.map((a) => ({ ...a, status: a.status === "busy" ? "idle" : a.status })));
    const client = createChannelClient(s);
    clientRef.current = client;
    setTransportLabel(client.label);
    const unsub = client.subscribe((e) => handleEventRef.current(e));
    try {
      await client.connect();
    } catch (err) {
      setConnection("error");
      setConnectionDetail(err instanceof Error ? err.message : String(err));
    }
    return () => {
      unsub();
      if (clientRef.current === client) {
        client.disconnect();
        clientRef.current = null;
      }
    };
  }, []);

  // Load settings once, then connect. Reconnects when transport settings change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadSettings();
      if (cancelled) return;
      setSettings(loaded);
      setSettingsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const transportKey = `${settings.useMockChannel}|${settings.zakuraBaseUrl}|${settings.authToken}`;
  useEffect(() => {
    if (!settingsReady) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void bootClient(settings).then((d) => {
      if (cancelled) d();
      else dispose = d;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsReady, transportKey, bootClient]);

  const selectAgent = useCallback((id: string) => {
    setSelectedId(id);
    selectedRef.current = id;
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, unread: false } : a)));
  }, []);

  const deliver = useCallback(
    async (agentId: string, text: string, messageId: string): Promise<boolean> => {
      const client = clientRef.current;
      const optimistic: ChatMessage = {
        id: messageId,
        agentId,
        role: "user",
        kind: "text",
        text,
        createdAt: Date.now(),
      };
      // Optimistic insert so the bubble appears instantly; the channel echoes the same id.
      upsertMessage(optimistic);
      try {
        if (!client) throw new Error("Channel not initialised");
        await client.sendMessage({ agentId, text, clientMessageId: messageId });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        upsertMessage({ ...optimistic, failed: true });
        setLastError({ id: uid("err"), message, agentId, at: Date.now() });
        return false;
      }
    },
    [upsertMessage],
  );

  const send = useCallback(
    async (text: string) => deliver(selectedRef.current, text, uid("user")),
    [deliver],
  );

  const retryMessage = useCallback(
    async (messageId: string) => {
      const agentId = selectedRef.current;
      const msg = (messagesByAgent[agentId] ?? []).find((m) => m.id === messageId);
      if (!msg || !msg.text) return false;
      // Drop the failed bubble; deliver() re-inserts it with a fresh timestamp.
      setMessagesByAgent((prev) => ({
        ...prev,
        [agentId]: (prev[agentId] ?? []).filter((m) => m.id !== messageId),
      }));
      return deliver(agentId, msg.text, messageId);
    },
    [deliver, messagesByAgent],
  );

  const interrupt = useCallback(async () => {
    await clientRef.current?.interrupt?.(selectedRef.current);
  }, []);

  const reconnect = useCallback(async () => {
    setLastError(null);
    await bootClient(settings);
  }, [bootClient, settings]);

  const dismissError = useCallback(() => setLastError(null), []);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    let next: AppSettings | undefined;
    setSettings((prev) => {
      next = { ...prev, ...patch };
      return next;
    });
    // setState updater runs synchronously in React 19 event handlers; persist after.
    await Promise.resolve();
    if (next) await saveSettings(next);
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      agents,
      selectedId,
      messagesByAgent,
      typing,
      settings,
      settingsReady,
      connection,
      connectionDetail,
      transportLabel,
      lastError,
      sidebarOpen,
      selectAgent,
      send,
      retryMessage,
      interrupt,
      reconnect,
      dismissError,
      updateSettings,
      setSidebarOpen,
    }),
    [
      agents,
      selectedId,
      messagesByAgent,
      typing,
      settings,
      settingsReady,
      connection,
      connectionDetail,
      transportLabel,
      lastError,
      sidebarOpen,
      selectAgent,
      send,
      retryMessage,
      interrupt,
      reconnect,
      dismissError,
      updateSettings,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

export function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** "Today", "Yesterday", or a short date for thread separators. */
export function formatDay(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  try {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
