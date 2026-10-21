import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import {
  createChannelClient, createDemoMessages, uid, validateLiveSettings, zakuraSocketUrl,
  type ChannelConnectionState, type ZakuraChannelClient,
} from "./channel";
import { DEMO_AGENTS } from "./channel/mock-client";
import { MAX_MESSAGE_LENGTH } from "./channel/types";
import { chatReducer, emptyChatState, isAgentWorking, previewFromMessages, type ChatAction, type ChannelError, type UnreadWindow } from "./chat-state";
import { loadSettings, saveSettings, loadProfiles, saveProfile, readCredentials, writeCredentials, removeProfile } from "./settings";
import { CredentialSession, instanceUrl, refreshOAuthToken, revokeOAuthToken, zakuraRequest, zakuraBinaryRequest,
  tokensFromOAuth, type InstanceProfile, type OAuthTokens, type ZakuraBinary } from "./auth";
import { agentPath, agentsPath, listSpaces, mePath, parseAccountInfo, parseAgentDetail, resolveSpaceId, type AgentDraft, type ManagedAgent, type SpaceInfo } from "./agents";
import { DEFAULT_SETTINGS, type Agent, type AppSettings, type ChatMessage, type InteractionAnswer, type MessageAttachment } from "./types";
import { emptyGroups, reduceGroups, type BotGroups, type GroupAction } from "./groups";
import { loadGroups, saveGroups } from "./group-storage";
import { loadHiddenBots, saveHiddenBots } from "./hidden-bots";
import { loadSpaceId, saveSpaceId } from "./space-storage";
import { botFilePath, fileMessageText, parseUploadedFile, validatePickedFiles, type DraftAttachment, type PickedFile } from "./files";
import { useAttachmentDrafts } from "./use-attachment-drafts";
import { attachmentReferences } from "./channel/protocol";
import { fetchInteraction, submitInteraction } from "./interactions";
import { addReaction, listReactions, removeReaction, toReactionMap } from "./reactions";

export type { ChannelError } from "./chat-state";

type StoreValue = {
  agents: Agent[];
  selectedId: string;
  messagesByAgent: Record<string, ChatMessage[]>;
  draftsByAgent: Record<string, string>;
  reactionsByAgent: Record<string, Record<string, Record<string, string>>>;
  unreadWindowByAgent: Record<string, UnreadWindow>;
  typing: Record<string, boolean>;
  interrupting: Record<string, boolean>;
  settings: AppSettings;
  settingsReady: boolean;
  profiles: InstanceProfile[];
  authNotice: string | null;
  reportAuthError: (message: string) => void;
  /** 服务端 space 列表；空数组 = 旧服务端（无 spaces），隐藏选择器 */
  spaces: SpaceInfo[];
  switchSpace: (space: SpaceInfo) => Promise<void>;
  completeSignIn: (baseUrl: string, clientId: string, tokens: OAuthTokens) => Promise<void>;
  switchInstance: (id: string) => Promise<void>;
  signOut: () => Promise<void>;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  requestBinary: (path: string, init?: RequestInit) => Promise<ZakuraBinary>;
  canLoadHistory: boolean;
  loadHistory: (agentId: string, before?: number) => Promise<{ nextBefore: number | null; added: ChatMessage[] }>;
  attachmentsByAgent: Record<string, DraftAttachment[]>;
  addAttachments: (agentId: string, files: PickedFile[]) => void;
  clearAttachments: (agentId: string, ids: string[]) => void;
  retryAttachment: (agentId: string, id: string) => void;
  /** True on a trusted instance: every agent is available and manageable. */
  canManage: boolean;
  createAgent: (draft: AgentDraft) => Promise<ManagedAgent>;
  updateAgent: (agentId: string, draft: AgentDraft) => Promise<ManagedAgent>;
  deleteAgent: (agentId: string) => Promise<void>;
  duplicateAgent: (agentId: string) => Promise<ManagedAgent>;
  groups: BotGroups;
  groupsReady: boolean;
  updateGroups: (action: GroupAction) => Promise<void>;
  hiddenBots: string[];
  setAgentHidden: (agentId: string, hidden: boolean) => Promise<void>;
  setAgentUnread: (agentId: string, unread: boolean) => void;
  /** The signed-in user id, used to mark which reactions are "mine". */
  currentUserId: string | null;
  connection: ChannelConnectionState;
  connectionDetail?: string;
  transportLabel: string;
  lastError: ChannelError | null;
  sidebarOpen: boolean;
  selectAgent: (id: string) => void;
  setDraft: (agentId: string, text: string) => void;
  /** Clear only the submitted draft; never overwrite text typed while awaiting send. */
  clearDraft: (agentId: string, submitted: string) => void;
  send: (text: string, agentId?: string, attachments?: MessageAttachment[]) => Promise<boolean>;
  retryMessage: (messageId: string) => Promise<boolean>;
  removeMessage: (messageId: string) => void;
  /** Toggle the current user's reaction: POST a new emoji, or DELETE the one already used. */
  toggleReaction: (agentId: string, messageId: string, emoji: string) => void;
  /** Drop a queued send and put its text back into the composer draft. */
  cancelQueued: (messageId: string) => void;
  respondInteraction: (agentId: string, messageId: string, answer: InteractionAnswer) => Promise<void>;
  refreshInteraction: (agentId: string, messageId: string) => Promise<void>;
  interrupt: () => Promise<void>;
  reconnect: () => Promise<void>;
  dismissError: () => void;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setSidebarOpen: (open: boolean) => void;
  setThreadVisible: (visible: boolean) => void;
};

const StoreContext = createContext<StoreValue | null>(null);

function channelScope(settings: AppSettings): string {
  if (settings.useMockChannel) return "mock";
  let endpoint = settings.zakuraBaseUrl.trim();
  try { endpoint = zakuraSocketUrl(endpoint); }
  catch { /* Invalid saved settings still reach the client's validation banner. */ }
  return JSON.stringify([endpoint, settings.profileId ?? settings.authToken.trim()]);
}

function sameEndpoint(left: string, right: string): boolean {
  try { return zakuraSocketUrl(left) === zakuraSocketUrl(right); }
  catch { return left.trim() === right.trim(); }
}

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
  const settingsScope = useMemo(() => channelScope(settings), [settings]);
  const [settingsReady, setSettingsReady] = useState(false);
  const [profiles, setProfiles] = useState<InstanceProfile[]>([]);
  const [spaces, setSpaces] = useState<SpaceInfo[]>([]);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const [groups, setGroups] = useState<BotGroups>(emptyGroups);
  const [groupsReady, setGroupsReady] = useState(false);
  const groupsRef = useRef(groups);
  const groupsScopeRef = useRef<string | null>(null);
  const groupsQueue = useRef<Promise<void>>(Promise.resolve());
  const [hiddenBots, setHiddenBots] = useState<string[]>([]);
  const hiddenRef = useRef(hiddenBots);
  const hiddenScopeRef = useRef<string | null>(null);
  const hiddenQueue = useRef<Promise<void>>(Promise.resolve());
  const tokenProviderRef = useRef<(() => Promise<string>) | null>(null);
  const authFailureRef = useRef<((detail?: string) => void) | null>(null);
  // A rejected token is terminal: offline queueing must not hold sends for it.
  const terminalRef = useRef(false);
  const [transportLabel, setTransportLabel] = useState("Mock");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const clientRef = useRef<ZakuraChannelClient | null>(null);
  const interactionSubmissions = useRef(new Map<string, Promise<void>>());
  const disposeRef = useRef<(() => void) | null>(null);
  const scopeRef = useRef<string | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const screenVisible = useRef(false);
  const foreground = useRef(true);
  const flushingQueue = useRef(false);
  const reactionFetches = useRef<{ scope: string; ids: Map<string, Set<string>> }>({ scope: "", ids: new Map() });

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
    terminalRef.current = false;
    dispatch({ type: "connection", state: "disconnected" });
    const scope = channelScope(nextSettings);
    // A different server/token must never inherit another channel's roster or drafts.
    if (scope !== scopeRef.current) {
      const messages = nextSettings.useMockChannel ? demoTranscript() : {};
      const agents = nextSettings.useMockChannel ? DEMO_AGENTS.map((agent) => ({ ...agent,
        preview: previewFromMessages(messages[agent.id] ?? []) ?? agent.preview })) : [];
      dispatch({ type: "reset", agents, messages });
      setCanManage(false);
      setCurrentUserId(null);
      currentUserIdRef.current = null;
      reactionFetches.current = { scope: "", ids: new Map() };
      scopeRef.current = scope;
    }
    let session: Promise<CredentialSession> | undefined;
    const getToken = async () => {
      if (!nextSettings.profileId) return nextSettings.authToken;
      const profileId = nextSettings.profileId;
      session ??= (async () => {
        const [credentials, profiles] = await Promise.all([readCredentials(profileId), loadProfiles()]);
        if (!credentials) throw new Error("Sign in to this Zakura instance again.");
        const clientId = profiles.find((profile) => profile.id === profileId)?.clientId ?? "";
        return new CredentialSession(credentials, (token) => refreshOAuthToken(nextSettings.zakuraBaseUrl, token, clientId), async (next) => {
          await writeCredentials(profileId, next);
          if (settingsRef.current.profileId === profileId) {
            settingsRef.current = { ...settingsRef.current, authToken: next.accessToken };
            setSettings(settingsRef.current);
          }
        });
      })();
      return (await session).getToken();
    };
    tokenProviderRef.current = getToken;
    const client = createChannelClient(nextSettings, nextSettings.profileId ? getToken : undefined);
    clientRef.current = client;
    setTransportLabel(client.label);
    const unsubscribe = client.subscribe((event) => {
      if (clientRef.current !== client) return;
      if (event.type === "connection") {
        if (event.authFailure) terminalRef.current = true;
        else if (event.state === "connected") terminalRef.current = false;
      }
      if (event.type === "connection" && event.authFailure) authFailureRef.current?.(event.detail);
      dispatch(event);
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
    // Management access follows the signed-in account's own role: ask once per connection.
    if (!nextSettings.useMockChannel) {
      const scope = channelScope(nextSettings);
      void (async () => {
        const token = await getToken();
        const account = await zakuraRequest<unknown>(nextSettings.zakuraBaseUrl, mePath(),
          { headers: { Authorization: `Bearer ${token}` } });
        const me = parseAccountInfo(account);
        if (channelScope(settingsRef.current) === scope) {
          setCanManage(me.canManage);
          const userId = (account as { user?: { id?: unknown } } | null)?.user?.id;
          const resolved = typeof userId === "string" && userId ? userId : null;
          currentUserIdRef.current = resolved;
          setCurrentUserId(resolved);
        }
      })().catch(() => undefined);
      // 协议 v1 向后兼容：旧服务端无 /spaces（或返回空）时视为单 space，隐藏选择器
      void (async () => {
        const token = await getToken();
        const rows = await listSpaces(nextSettings.zakuraBaseUrl, token);
        if (channelScope(settingsRef.current) === scope) setSpaces(rows);
      })().catch(() => setSpaces([]));
    }
  }, [dispatch]);

  useEffect(() => {
    let cancelled = false;
    void loadSettings().then(async (loaded) => {
      const savedProfiles = await loadProfiles();
      if (cancelled) return;
      setProfiles(savedProfiles);
      settingsRef.current = loaded;
      setSettings(loaded);
      setSettingsReady(true);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setAuthNotice(error instanceof Error ? error.message : "Could not read saved credentials.");
      setSettingsReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!settingsReady || !settings.onboardingComplete) {
      disposeRef.current?.();
      dispatch({ type: "reset", agents: [], messages: {} });
      scopeRef.current = null;
      return;
    }
    // Formatting an equivalent URL or editing unused mock credentials must
    // not interrupt output, lose drafts, or replace the client's retry ids.
    bootClient(settingsRef.current);
    return () => { disposeRef.current?.(); disposeRef.current = null; };
  }, [settingsReady, settingsScope, settings.onboardingComplete, bootClient, dispatch]);

  useEffect(() => {
    if (!settingsReady || settings.useMockChannel || !settings.onboardingComplete) return;
    const refresh = () => {
      const client = clientRef.current;
      const before = settingsRef.current.authToken;
      void tokenProviderRef.current?.().then((token) => {
        if (clientRef.current === client && token !== before && client?.getConnectionState() === "error") void client.connect();
      }).catch((error: unknown) => setAuthNotice(error instanceof Error ? error.message : "Sign in again to refresh your login."));
    };
    const timer = setInterval(refresh, 30_000);
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") refresh(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [settingsReady, settingsScope, settings.useMockChannel, settings.onboardingComplete]);

  useEffect(() => {
    if (!settingsReady) return;
    let cancelled = false;
    groupsScopeRef.current = null;
    groupsRef.current = emptyGroups(); setGroups(groupsRef.current); setGroupsReady(false);
    void loadGroups(settingsScope).then((loaded) => {
      if (cancelled) return;
      groupsRef.current = loaded; groupsScopeRef.current = settingsScope; setGroups(loaded); setGroupsReady(true);
    }).catch((error: unknown) => { if (!cancelled) setAuthNotice(error instanceof Error ? error.message : "Could not load groups."); });
    return () => { cancelled = true; groupsScopeRef.current = null; };
  }, [settingsReady, settingsScope]);

  useEffect(() => {
    if (!settingsReady) return;
    let cancelled = false;
    hiddenScopeRef.current = null;
    hiddenRef.current = []; setHiddenBots(hiddenRef.current);
    void loadHiddenBots(settingsScope).then((loaded) => {
      if (cancelled) return;
      hiddenRef.current = loaded; hiddenScopeRef.current = settingsScope; setHiddenBots(loaded);
    }).catch((error: unknown) => { if (!cancelled) setAuthNotice(error instanceof Error ? error.message : "Could not load hidden bots."); });
    return () => { cancelled = true; hiddenScopeRef.current = null; };
  }, [settingsReady, settingsScope]);

  const updateGroups = useCallback((action: GroupAction) => {
    const scope = groupsScopeRef.current;
    const pending = groupsQueue.current.catch(() => undefined).then(async () => {
      if (!scope || scope !== groupsScopeRef.current) throw new Error("Wait for this instance’s groups to load.");
      const next = reduceGroups(groupsRef.current, action);
      await saveGroups(scope, next);
      if (scope === groupsScopeRef.current) { groupsRef.current = next; setGroups(next); }
    });
    groupsQueue.current = pending;
    return pending;
  }, []);

  const setAgentHidden = useCallback((agentId: string, hidden: boolean) => {
    const scope = hiddenScopeRef.current;
    const pending = hiddenQueue.current.catch(() => undefined).then(async () => {
      if (!scope || scope !== hiddenScopeRef.current) throw new Error("Wait for this instance’s bots to load.");
      const next = hidden ? (hiddenRef.current.includes(agentId) ? hiddenRef.current : [...hiddenRef.current, agentId])
        : hiddenRef.current.filter((id) => id !== agentId);
      await saveHiddenBots(scope, next);
      if (scope === hiddenScopeRef.current) { hiddenRef.current = next; setHiddenBots(next); }
    });
    hiddenQueue.current = pending;
    return pending;
  }, []);

  const setAgentUnread = useCallback((agentId: string, unread: boolean) => {
    if (stateRef.current.agents.some((agent) => agent.id === agentId)) dispatch({ type: "read", agentId, unread });
  }, [dispatch]);

  const selectAgent = useCallback((agentId: string) => dispatch({ type: "select", agentId }), [dispatch]);
  const setDraft = useCallback((agentId: string, text: string) => {
    if (stateRef.current.agents.some((agent) => agent.id === agentId)) dispatch({ type: "draft", agentId, text });
  }, [dispatch]);
  const clearDraft = useCallback((agentId: string, submitted: string) => {
    if (stateRef.current.draftsByAgent[agentId] === submitted) dispatch({ type: "draft", agentId, text: "" });
  }, [dispatch]);

  const request = useCallback(async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const current = settingsRef.current, scope = channelScope(current);
    if (current.useMockChannel) throw new Error("Connect a Zakura instance to use this feature.");
    const token = await tokenProviderRef.current?.() ?? current.authToken;
    if (channelScope(settingsRef.current) !== scope) throw new Error("The active instance changed. Please try again.");
    const result = await zakuraRequest<T>(current.zakuraBaseUrl, path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (channelScope(settingsRef.current) !== scope) throw new Error("The active instance changed. Please try again.");
    return result;
  }, []);
  const requestBinary = useCallback(async (path: string, init: RequestInit = {}) => {
    const current = settingsRef.current, scope = channelScope(current);
    if (current.useMockChannel) throw new Error("Connect a Zakura instance to use this feature.");
    const token = await tokenProviderRef.current?.() ?? current.authToken;
    if (channelScope(settingsRef.current) !== scope) throw new Error("The active instance changed. Please try again.");
    const result = await zakuraBinaryRequest(current.zakuraBaseUrl, path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (channelScope(settingsRef.current) !== scope) throw new Error("The active instance changed. Please try again.");
    return result;
  }, []);
  const loadHistory = useCallback(async (agentId: string, before?: number) => {
    const client = clientRef.current;
    if (!client?.fetchHistory) throw new Error("This channel cannot load earlier history.");
    const scope = channelScope(settingsRef.current);
    const added: ChatMessage[] = [];
    let cursor = before;
    // The live server's socket replay has no seq, so the first REST page can
    // repeat it. Advance until a page contributes older rows or history ends.
    for (let page = 0; page < 20; page++) {
      const result = await client.fetchHistory(agentId, cursor);
      if (channelScope(settingsRef.current) !== scope) throw new Error("The active instance changed.");
      let fresh = 0;
      for (const message of result.messages) {
        const known = (stateRef.current.messagesByAgent[agentId] ?? []).some((existing) =>
          existing.id === message.id || existing.serverId === message.id ||
          (message.clientMessageId !== undefined &&
            (existing.id === message.clientMessageId || existing.clientMessageId === message.clientMessageId)));
        if (!known) { added.push(message); fresh += 1; }
        dispatch({ type: "message", message });
      }
      if (fresh > 0 || result.nextBefore === null) return { nextBefore: result.nextBefore, added };
      cursor = result.nextBefore;
    }
    return { nextBefore: cursor ?? null, added };
  }, [dispatch]);
  const uploadFile = useCallback(async (agentId: string, file: PickedFile, signal: AbortSignal) => {
    if (!stateRef.current.agents.some((agent) => agent.id === agentId && agent.capabilities?.files)) throw new Error("File uploads are unavailable for this bot.");
    validatePickedFiles([file]);
    const body = new FormData();
    if (Platform.OS === "web") {
      if (!file.file) throw new Error("Choose this file again.");
      body.append("file", file.file, file.name);
    } else body.append("file", { uri: file.uri, name: file.name, type: file.mime } as unknown as Blob);
    const result = await request<{ file: unknown }>(botFilePath(agentId), { method: "POST", body, signal });
    if (!stateRef.current.agents.some((agent) => agent.id === agentId)) throw new Error("This bot is no longer authorized.");
    return parseUploadedFile(result.file);
  }, [request]);
  const { attachmentsByAgent, addAttachments, clearAttachments, retryAttachment } = useAttachmentDrafts(settingsScope, uploadFile);

  const applyInteraction = useCallback((message: ChatMessage, client: ZakuraChannelClient | null) => {
    if (client !== clientRef.current) throw new Error("The active connection changed.");
    if (!stateRef.current.agents.some((agent) => agent.id === message.agentId)) throw new Error("This bot is no longer authorized.");
    dispatch({ type: "message", message });
  }, [dispatch]);
  const refreshInteraction = useCallback(async (agentId: string, messageId: string) => {
    const client = clientRef.current;
    applyInteraction(await fetchInteraction(request, agentId, messageId), client);
  }, [request, applyInteraction]);
  const respondInteraction = useCallback((agentId: string, messageId: string, answer: InteractionAnswer): Promise<void> => {
    const client = clientRef.current;
    const key = JSON.stringify([channelScope(settingsRef.current), agentId, messageId]);
    const pending = interactionSubmissions.current.get(key);
    if (pending) return pending;
    const message = stateRef.current.messagesByAgent[agentId]?.find((item) => item.id === messageId);
    if (!message?.interaction) return Promise.reject(new Error("This request is no longer available."));
    if (stateRef.current.connection !== "connected") return Promise.reject(new Error("Reconnect before responding to this request."));
    const submission = submitInteraction(request, message, answer).then((updated) => applyInteraction(updated, client))
      .finally(() => { if (interactionSubmissions.current.get(key) === submission) interactionSubmissions.current.delete(key); });
    interactionSubmissions.current.set(key, submission);
    return submission;
  }, [request, applyInteraction]);

  const deliver = useCallback(async (agentId: string, text: string, messageId: string, attachments?: MessageAttachment[]): Promise<boolean> => {
    const current = stateRef.current;
    const client = clientRef.current;
    const agent = current.agents.find((item) => item.id === agentId);
    const trimmed = fileMessageText(text, attachments);
    if (!agent || (!trimmed && !attachments?.length) || trimmed.length > MAX_MESSAGE_LENGTH || isAgentWorking(current, agentId) ||
      current.messagesByAgent[agentId]?.some((message) => message.pending)) return false;
    try { attachmentReferences(attachments); }
    catch (error) { dispatch({ type: "error", agentId, message: error instanceof Error ? error.message : "Invalid attachments." }); return false; }
    const previous = current.messagesByAgent[agentId]?.find((message) => message.id === messageId);
    const localCreatedAt = previous?.createdAt ?? Date.now();
    // A rejected token is terminal and an offline agent is unreachable; only a
    // plain offline/reconnecting channel holds the send in the queue.
    if (agent.status === "offline" || terminalRef.current) {
      dispatch({ type: "error", agentId, message: "This conversation is offline. Reconnect or choose an available agent." });
      return false;
    }
    if (!client || client.getConnectionState() !== "connected") {
      dispatch({ type: "queue", message: { id: messageId, agentId, role: "user", kind: "text", text: trimmed,
        createdAt: localCreatedAt, ...(attachments?.length ? { attachments } : {}) } });
      return true;
    }
    dispatch({ type: "optimistic", message: { id: messageId, agentId, role: "user", kind: "text", text: trimmed,
      createdAt: localCreatedAt, ...(attachments?.length ? { attachments } : {}) } });
    try {
      await client.sendMessage({ agentId, text: trimmed, clientMessageId: messageId, localCreatedAt, attachments });
      return clientRef.current === client && client.getConnectionState() === "connected" &&
        stateRef.current.messagesByAgent[agentId]?.some((message) => message.id === messageId && !message.failed) === true;
    } catch (error) {
      if (clientRef.current === client) dispatch({ type: "error", agentId, clientMessageId: messageId,
        message: error instanceof Error ? error.message : "Could not send the message." });
      return false;
    }
  }, [dispatch]);

  const send = useCallback((text: string, agentId?: string, attachments?: MessageAttachment[]) =>
    deliver(agentId ?? stateRef.current.selectedId, text, uid("user"), attachments), [deliver]);

  // Explicit store-initiated sends after reconnect. The client itself never
  // retries; this walks the queue once, in send order, through the transport.
  const flushQueued = useCallback(async () => {
    const client = clientRef.current;
    if (!client || client.getConnectionState() !== "connected" || flushingQueue.current) return;
    flushingQueue.current = true;
    try {
      const queued: ChatMessage[] = [];
      for (const agent of stateRef.current.agents) {
        for (const message of stateRef.current.messagesByAgent[agent.id] ?? []) {
          if (message.role === "user" && message.queued) queued.push(message);
        }
      }
      for (const message of queued.sort((a, b) => a.createdAt - b.createdAt)) {
        if (clientRef.current !== client || client.getConnectionState() !== "connected") break;
        dispatch({ type: "flush", agentId: message.agentId, messageId: message.id });
        try {
          await client.sendMessage({ agentId: message.agentId, text: message.text ?? "", clientMessageId: message.id,
            localCreatedAt: message.createdAt, attachments: message.attachments });
        } catch (error) {
          if (clientRef.current === client) dispatch({ type: "error", agentId: message.agentId, clientMessageId: message.id,
            message: error instanceof Error ? error.message : "Could not send the message." });
        }
      }
    } finally {
      flushingQueue.current = false;
    }
  }, [dispatch]);

  const cancelQueued = useCallback((messageId: string) => {
    const agentId = stateRef.current.selectedId;
    const message = stateRef.current.messagesByAgent[agentId]?.find((item) => item.role === "user" && item.queued === true &&
      (item.id === messageId || item.clientMessageId === messageId));
    if (!message) return;
    dispatch({ type: "cancel_queued", agentId, messageId: message.id });
    const text = message.text ?? "";
    const draft = stateRef.current.draftsByAgent[agentId] ?? "";
    setDraft(agentId, draft.trim() === "" || draft === text ? text : `${text}\n${draft}`);
  }, [dispatch, setDraft]);

  useEffect(() => {
    if (state.connection !== "connected") return;
    void flushQueued();
  }, [state.connection, flushQueued]);

  // Reactions are not replayed on reconnect, so read them for the loaded page.
  useEffect(() => {
    if (state.connection !== "connected" || settings.useMockChannel || !state.selectedId) return;
    const scope = channelScope(settingsRef.current);
    const cache = reactionFetches.current;
    if (cache.scope !== scope) { cache.scope = scope; cache.ids.clear(); }
    const agentId = state.selectedId;
    const fetched = cache.ids.get(agentId) ?? new Set<string>();
    cache.ids.set(agentId, fetched);
    const targets = (state.messagesByAgent[agentId] ?? [])
      .filter((message) => message.kind === "text" && !message.pending && !message.queued && !message.failed)
      .slice(-50).map((message) => message.serverId ?? message.id).filter((id) => !fetched.has(id));
    if (!targets.length) return;
    for (const id of targets) fetched.add(id);
    // Bounded parallel reads; a failed message stays silent and is skipped.
    const queue = [...targets];
    for (let worker = 0; worker < Math.min(4, queue.length); worker++) {
      void (async () => {
        while (queue.length) {
          const messageId = queue.shift()!;
          if (channelScope(settingsRef.current) !== scope) return;
          try {
            const rows = await listReactions(request, agentId, messageId);
            if (channelScope(settingsRef.current) !== scope) return;
            dispatch({ type: "setReactions", agentId, messageId, reactions: toReactionMap(rows) });
          } catch { /* Reactions are a quiet overlay; never surface a load failure. */ }
        }
      })();
    }
  }, [state.connection, state.selectedId, state.messagesByAgent, settings.useMockChannel, request, dispatch]);

  const retryMessage = useCallback(async (messageId: string) => {
    const agentId = stateRef.current.selectedId;
    const message = stateRef.current.messagesByAgent[agentId]?.find((item) => item.id === messageId);
    if (!message?.failed || message.role !== "user" || (!message.text && !message.attachments?.length)) return false;
    const draft = stateRef.current.draftsByAgent[agentId] ?? "";
    const ok = await deliver(agentId, message.text ?? "", messageId, message.attachments);
    if (ok) {
      if (draft.trim() === message.text) clearDraft(agentId, draft);
      clearAttachments(agentId, (attachmentsByAgent[agentId] ?? []).filter((row) => message.attachments?.some((file) => file.id === row.file?.id)).map((row) => row.id));
    }
    return ok;
  }, [deliver, clearDraft, clearAttachments, attachmentsByAgent]);

  const removeMessage = useCallback((messageId: string) => {
    dispatch({ type: "remove_message", agentId: stateRef.current.selectedId, messageId });
  }, [dispatch]);

  const toggleReaction = useCallback((agentId: string, messageId: string, emoji: string) => {
    const me = currentUserIdRef.current;
    const current = stateRef.current;
    if (!me || !current.agents.some((agent) => agent.id === agentId)) return;
    const mine = current.reactionsByAgent[agentId]?.[messageId]?.[me];
    const removing = mine === emoji;
    const apply = (op: "add" | "remove", value: string) =>
      dispatch({ type: "reaction", messageId, emoji: value, userId: me, op });
    apply(removing ? "remove" : "add", emoji);
    const scope = channelScope(settingsRef.current);
    const call = removing ? removeReaction(request, agentId, messageId, emoji)
      : addReaction(request, agentId, messageId, emoji);
    void call.catch((error: unknown) => {
      if (channelScope(settingsRef.current) !== scope) return;
      // Restore the previous reaction before explaining the failure.
      if (removing) apply("add", emoji);
      else if (mine === undefined) apply("remove", emoji);
      else apply("add", mine);
      dispatch({ type: "error", agentId, message: error instanceof Error ? error.message : "Could not update the reaction." });
    });
  }, [dispatch, request]);

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

  const reconnect = useCallback(async () => {
    const client = clientRef.current;
    if (!client) { bootClient(settingsRef.current); return; }
    // Keep idempotency keys and receipt aliases for this channel identity.
    // A different endpoint, token or mode creates a new client and scoped data.
    client.disconnect();
    try { await client.connect(); }
    catch (error) {
      if (clientRef.current === client) dispatch({ type: "connection", state: "error",
        detail: error instanceof Error ? error.message : "Could not reconnect to the channel." });
    }
  }, [bootClient, dispatch]);
  const lastError = [...state.errors].reverse().find((error) => !error.agentId || error.agentId === state.selectedId) ?? null;
  const dismissError = useCallback(() => {
    // A channel event can replace or resolve an error before React commits.
    // Dismiss only the explanation rendered with this control, never whichever
    // error a new event has just put at the front of the current state.
    if (lastError) dispatch({ type: "dismiss_error", error: lastError });
  }, [dispatch, lastError]);

  const updateSettings = useCallback((patch: Partial<AppSettings>): Promise<void> => {
    const pending = saveQueue.current.catch(() => undefined).then(async () => {
      const next = { ...settingsRef.current, ...patch };
      next.zakuraBaseUrl = next.zakuraBaseUrl.trim();
      next.authToken = next.authToken.trim();
      if (patch.onboardingComplete === undefined) next.onboardingComplete = true;
      if (patch.profileId === undefined && (next.authToken !== settingsRef.current.authToken ||
        !sameEndpoint(next.zakuraBaseUrl, settingsRef.current.zakuraBaseUrl))) {
        next.profileId = next.authToken ? uid("manual") : undefined;
      }
      if (!next.useMockChannel) {
        const problem = validateLiveSettings({ baseUrl: next.zakuraBaseUrl, token: next.authToken });
        if (problem) throw new Error(problem);
      }
      await saveSettings(next);
      setProfiles(await loadProfiles());
      setAuthNotice(null);
      if (JSON.stringify(next) !== JSON.stringify(settingsRef.current)) {
        settingsRef.current = next;
        setSettings(next);
      }
    });
    saveQueue.current = pending;
    return pending;
  }, []);

  const reportAuthError = useCallback((message: string) => { setAuthNotice(message); }, []);

  // 4401 rejects the token outright, so reconnecting cannot recover: return to sign-in with the reason.
  const handleAuthFailure = useCallback(async (detail?: string) => {
    const notice = detail?.trim() || "Your Zakura session was rejected. Sign in again.";
    const current = settingsRef.current;
    if (current.profileId) await removeProfile(current.profileId).catch(() => undefined);
    await updateSettings({ authToken: "", profileId: "", useMockChannel: true, onboardingComplete: false });
    setAuthNotice(notice);
  }, [updateSettings]);

  useEffect(() => {
    authFailureRef.current = (detail) => void handleAuthFailure(detail);
    return () => { authFailureRef.current = null; };
  }, [handleAuthFailure]);

  // 切换绑定的 Space：按账号持久化；roster / 管理页 / 会话随之重载
  const switchSpace = useCallback(async (space: SpaceInfo) => {
    await saveSpaceId(channelScope(settingsRef.current), space.id);
    await updateSettings({ spaceId: space.id, spaceName: space.name });
    await reconnect();
  }, [updateSettings, reconnect]);

  // 按账号恢复已选 Space；没有保存过则自动选中默认/第一个 space。
  useEffect(() => {
    if (!settingsReady || settings.useMockChannel || !settings.onboardingComplete || !spaces.length) return;
    const scope = settingsScope;
    let cancelled = false;
    void (async () => {
      const saved = await loadSpaceId(scope).catch(() => null);
      const next = resolveSpaceId(spaces, saved);
      if (cancelled || !next) return;
      if (settingsRef.current.spaceId === next) { await saveSpaceId(scope, next); return; }
      const space = spaces.find((row) => row.id === next);
      await saveSpaceId(scope, next);
      await updateSettings({ spaceId: next, spaceName: space?.name });
      await reconnect();
    })().catch(() => undefined);
    return () => { cancelled = true; };
  }, [settingsReady, settingsScope, spaces, settings.useMockChannel, settings.onboardingComplete, updateSettings, reconnect]);

  const completeSignIn = useCallback(async (baseUrl: string, clientId: string, tokens: OAuthTokens) => {
    const credentials = tokensFromOAuth(tokens);
    const base = instanceUrl(baseUrl);
    const profile: InstanceProfile = { id: uid("instance"), baseUrl: base,
      label: new URL(base).hostname, clientId };
    await saveProfile(profile, credentials);
    await updateSettings({ zakuraBaseUrl: base, authToken: credentials.accessToken, profileId: profile.id,
      useMockChannel: false, onboardingComplete: true });
  }, [updateSettings]);

  const switchInstance = useCallback(async (id: string) => {
    const profile = (await loadProfiles()).find((item) => item.id === id);
    const credentials = profile ? await readCredentials(id) : null;
    if (!profile || !credentials) throw new Error("This instance needs a new login. Use Add instance to sign in.");
    await updateSettings({ zakuraBaseUrl: profile.baseUrl, authToken: credentials.accessToken, profileId: id,
      useMockChannel: false, onboardingComplete: true });
  }, [updateSettings]);

  const signOut = useCallback(async () => {
    const current = settingsRef.current;
    disposeRef.current?.();
    let notice: string | null = null;
    // Settle a rotation before revoking, so its newly issued refresh token cannot escape logout.
    await tokenProviderRef.current?.().catch(() => undefined);
    const credentials = current.profileId ? await readCredentials(current.profileId) : null;
    if (!current.useMockChannel && (credentials || current.authToken)) {
      try { await revokeOAuthToken(current.zakuraBaseUrl, credentials?.refreshToken ?? credentials?.accessToken ?? current.authToken); }
      catch { notice = "Signed out on this device. Zakura was unreachable; revoke the session on the server to end its access."; }
    }
    if (current.profileId) await removeProfile(current.profileId);
    await updateSettings({ authToken: "", profileId: "", useMockChannel: true, onboardingComplete: false });
    setAuthNotice(notice);
  }, [updateSettings]);

  // Management goes through Zakura's standard agent API with the account's own
  // permissions; the server pushes a fresh roster frame after each change.
  const createAgent = useCallback(async (draft: AgentDraft) => {
    const spaceId = draft.spaceId ?? settingsRef.current.spaceId;
    const body = { ...draft, ...(spaceId ? { spaceId } : {}) };
    const result = await request<unknown>(agentsPath(spaceId), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return parseAgentDetail(result);
  }, [request]);
  const updateAgent = useCallback(async (agentId: string, draft: AgentDraft) => {
    const result = await request<unknown>(agentPath(agentId), {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    return parseAgentDetail(result);
  }, [request]);
  const deleteAgent = useCallback(async (agentId: string) => {
    await request(agentPath(agentId), { method: "DELETE" });
  }, [request]);
  const duplicateAgent = useCallback(async (agentId: string) => {
    const result = await request<unknown>(`${agentPath(agentId)}/duplicate`, { method: "POST" });
    return parseAgentDetail(result);
  }, [request]);

  const value = useMemo<StoreValue>(() => ({
    agents: state.agents, selectedId: state.selectedId, messagesByAgent: state.messagesByAgent,
    draftsByAgent: state.draftsByAgent, reactionsByAgent: state.reactionsByAgent,
    unreadWindowByAgent: state.unreadWindowByAgent,
    typing: Object.fromEntries(state.agents.map((agent) => [agent.id, isAgentWorking(state, agent.id)])),
    interrupting: state.interrupting, connection: state.connection,
    connectionDetail: state.connectionDetail, settings, settingsReady, transportLabel, lastError,
    profiles, authNotice, reportAuthError, spaces, switchSpace, completeSignIn, switchInstance, signOut, request, groups, groupsReady, updateGroups,
    hiddenBots, setAgentHidden, setAgentUnread, currentUserId,
    canManage, createAgent, updateAgent, deleteAgent, duplicateAgent,
    requestBinary, attachmentsByAgent, addAttachments, clearAttachments, retryAttachment,
    canLoadHistory: !settings.useMockChannel, loadHistory,
    sidebarOpen, selectAgent, setDraft, clearDraft, send, retryMessage, removeMessage, toggleReaction, cancelQueued, respondInteraction, refreshInteraction, interrupt, reconnect,
    dismissError, updateSettings, setSidebarOpen, setThreadVisible,
  }), [state, settings, settingsReady, transportLabel, lastError, sidebarOpen, selectAgent, setDraft,
    clearDraft, send, retryMessage, removeMessage, toggleReaction, cancelQueued, respondInteraction, refreshInteraction, interrupt, reconnect, dismissError, updateSettings, setThreadVisible,
    profiles, authNotice, reportAuthError, spaces, switchSpace, completeSignIn, switchInstance, signOut, request, groups, groupsReady, updateGroups,
    hiddenBots, setAgentHidden, setAgentUnread, currentUserId,
    canManage, createAgent, updateAgent, deleteAgent, duplicateAgent,
    requestBinary, attachmentsByAgent, addAttachments, clearAttachments, retryAttachment, loadHistory]);

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

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

export function formatDay(ts: number): string {
  const date = new Date(ts);
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric",
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" as const } : {}) });
}

export function formatSidebarDate(ts: number): string {
  const date = new Date(ts);
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (diffDays === 0) return formatTime(ts);
  return formatDay(ts);
}
