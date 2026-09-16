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
  createDemoMessages,
  MockZakuraChannelClient,
  type ChannelConnectionState,
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
    preview: "Offline — connect Zakura",
  },
];

type StoreValue = {
  agents: Agent[];
  selectedId: string;
  messagesByAgent: Record<string, ChatMessage[]>;
  streamingText: Record<string, string>;
  typing: Record<string, boolean>;
  settings: AppSettings;
  settingsReady: boolean;
  connection: ChannelConnectionState;
  sidebarOpen: boolean;
  selectAgent: (id: string) => void;
  send: (text: string) => Promise<void>;
  interrupt: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setSidebarOpen: (open: boolean) => void;
};

const StoreContext = createContext<StoreValue | null>(null);

function previewFromMessages(msgs: ChatMessage[]): string | undefined {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.kind === "activity" && m.tool) return m.tool.name;
    if (m.text) return m.text;
  }
  return undefined;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [agents, setAgents] = useState<Agent[]>(DEMO_AGENTS);
  const [selectedId, setSelectedId] = useState(DEMO_AGENTS[0].id);
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
  const [streamingText, setStreamingText] = useState<Record<string, string>>({});
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [connection, setConnection] = useState<ChannelConnectionState>("disconnected");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const clientRef = useRef<ZakuraChannelClient | null>(null);

  const upsertMessage = useCallback((message: ChatMessage) => {
    setMessagesByAgent((prev) => {
      const list = prev[message.agentId] ?? [];
      const idx = list.findIndex((m) => m.id === message.id);
      const next =
        idx >= 0
          ? list.map((m, i) => (i === idx ? { ...m, ...message } : m))
          : [...list, message];
      return { ...prev, [message.agentId]: next };
    });
    setAgents((prev) =>
      prev.map((a) =>
        a.id === message.agentId
          ? {
              ...a,
              preview: message.kind === "activity" ? message.tool?.name : message.text ?? a.preview,
              unread: a.id !== selectedId,
            }
          : a,
      ),
    );
  }, [selectedId]);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;

    (async () => {
      const loaded = await loadSettings();
      if (cancelled) return;
      setSettings(loaded);
      setSettingsReady(true);

      const client = new MockZakuraChannelClient();
      clientRef.current = client;
      unsub = client.subscribe((event) => {
        switch (event.type) {
          case "connection":
            setConnection(event.state);
            break;
          case "message":
            upsertMessage(event.message);
            break;
          case "tool_activity":
            upsertMessage(event.message);
            break;
          case "message_delta":
            setStreamingText((s) => ({
              ...s,
              [event.messageId]: (s[event.messageId] ?? "") + event.delta,
            }));
            setMessagesByAgent((prev) => {
              const list = prev[event.agentId] ?? [];
              return {
                ...prev,
                [event.agentId]: list.map((m) =>
                  m.id === event.messageId
                    ? {
                        ...m,
                        text: (m.text ?? "") + event.delta,
                        streaming: true,
                      }
                    : m,
                ),
              };
            });
            break;
          case "message_done":
            setStreamingText((s) => {
              const { [event.messageId]: _, ...rest } = s;
              return rest;
            });
            setMessagesByAgent((prev) => {
              const list = prev[event.agentId] ?? [];
              const updated = list.map((m) =>
                m.id === event.messageId ? { ...m, streaming: false } : m,
              );
              setAgents((ags) =>
                ags.map((a) =>
                  a.id === event.agentId
                    ? { ...a, status: "idle", preview: previewFromMessages(updated) }
                    : a,
                ),
              );
              return { ...prev, [event.agentId]: updated };
            });
            break;
          case "typing":
            setTyping((t) => ({ ...t, [event.agentId]: event.active }));
            setAgents((ags) =>
              ags.map((a) =>
                a.id === event.agentId
                  ? { ...a, status: event.active ? "busy" : "idle" }
                  : a,
              ),
            );
            break;
          case "error":
            console.warn("[zakura-channel]", event.message);
            break;
        }
      });
      await client.connect();
    })();

    return () => {
      cancelled = true;
      unsub?.();
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, [upsertMessage]);

  const selectAgent = useCallback((id: string) => {
    setSelectedId(id);
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, unread: false } : a)));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const client = clientRef.current;
      if (!client) return;
      setAgents((ags) =>
        ags.map((a) => (a.id === selectedId ? { ...a, status: "busy", preview: text } : a)),
      );
      await client.sendMessage({ agentId: selectedId, text });
    },
    [selectedId],
  );

  const interrupt = useCallback(async () => {
    await clientRef.current?.interrupt?.(selectedId);
  }, [selectedId]);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void saveSettings(next);
      return next;
    });
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      agents,
      selectedId,
      messagesByAgent,
      streamingText,
      typing,
      settings,
      settingsReady,
      connection,
      sidebarOpen,
      selectAgent,
      send,
      interrupt,
      updateSettings,
      setSidebarOpen,
    }),
    [
      agents,
      selectedId,
      messagesByAgent,
      streamingText,
      typing,
      settings,
      settingsReady,
      connection,
      sidebarOpen,
      selectAgent,
      send,
      interrupt,
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
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
