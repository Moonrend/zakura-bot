import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import {
  createChannelClient, createDemoMessages, uid, validateLiveSettings, zakuraSocketUrl,
  type ChannelConnectionState, type ZakuraChannelClient,
} from "./channel";
import { DEMO_AGENTS } from "./channel/mock-client";
import { MAX_MESSAGE_LENGTH } from "./channel/types";
import { chatReducer, emptyChatState, isAgentWorking, previewFromMessages, type ChatAction, type ChannelError } from "./chat-state";
import { loadSettings, saveSettings, loadProfiles, saveProfile, readCredentials, writeCredentials, removeProfile } from "./settings";
import { CredentialSession, credentialsFromToken, instanceUrl, refreshAuthorization, revokeAuthorization, zakuraRequest, zakuraBinaryRequest,
  type InstanceProfile, type TokenResponse, type ZakuraBinary } from "./auth";
import { DEFAULT_SETTINGS, type Agent, type AppSettings, type ChatMessage, type BotSession, type InteractionAnswer, type MessageAttachment } from "./types";
import { emptyGroups, reduceGroups, type BotGroups, type GroupAction } from "./groups";
import { loadGroups, saveGroups } from "./group-storage";
import { botFilePath, fileMessageText, parseUploadedFile, validatePickedFiles, type DraftAttachment, type PickedFile } from "./files";
import { useAttachmentDrafts } from "./use-attachment-drafts";
import { attachmentReferences } from "./channel/protocol";
import { fetchInteraction, submitInteraction } from "./interactions";

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
  profiles: InstanceProfile[];
  authNotice: string | null;
  finishSignIn: (baseUrl: string, tokens: TokenResponse) => Promise<void>;
  switchInstance: (id: string) => Promise<void>;
  signOut: () => Promise<void>;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  requestBinary: (path: string, init?: RequestInit) => Promise<ZakuraBinary>;
  attachmentsByAgent: Record<string, DraftAttachment[]>;
  addAttachments: (agentId: string, files: PickedFile[]) => void;
  clearAttachments: (agentId: string, ids: string[]) => void;
  retryAttachment: (agentId: string, id: string) => void;
  sessions: Record<string, BotSession>;
  sessionAction: (agentId: string, action: "status" | "start" | "stop" | "new") => Promise<BotSession>;
  groups: BotGroups;
  groupsReady: boolean;
  updateGroups: (action: GroupAction) => Promise<void>;
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
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<string, BotSession>>({});
  const [groups, setGroups] = useState<BotGroups>(emptyGroups);
  const [groupsReady, setGroupsReady] = useState(false);
  const groupsRef = useRef(groups);
  const groupsScopeRef = useRef<string | null>(null);
  const groupsQueue = useRef<Promise<void>>(Promise.resolve());
  const tokenProviderRef = useRef<(() => Promise<string>) | null>(null);
  const [transportLabel, setTransportLabel] = useState("Mock");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const clientRef = useRef<ZakuraChannelClient | null>(null);
  const interactionSubmissions = useRef(new Map<string, Promise<void>>());
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
    const scope = channelScope(nextSettings);
    // A different server/token must never inherit another channel's roster or drafts.
    if (scope !== scopeRef.current) {
      const messages = nextSettings.useMockChannel ? demoTranscript() : {};
      const agents = nextSettings.useMockChannel ? DEMO_AGENTS.map((agent) => ({ ...agent,
        preview: previewFromMessages(messages[agent.id] ?? []) ?? agent.preview })) : [];
      dispatch({ type: "reset", agents, messages });
      setSessions({});
      scopeRef.current = scope;
    }
    let session: Promise<CredentialSession> | undefined;
    const getToken = async () => {
      if (!nextSettings.profileId) return nextSettings.authToken;
      const profileId = nextSettings.profileId;
      session ??= readCredentials(profileId).then((credentials) => {
        if (!credentials) throw new Error("Sign in to this Zakura instance again.");
        return new CredentialSession(credentials, (token) => refreshAuthorization(nextSettings.zakuraBaseUrl, token), async (next) => {
          await writeCredentials(profileId, next);
          if (settingsRef.current.profileId === profileId) {
            settingsRef.current = { ...settingsRef.current, authToken: next.accessToken };
            setSettings(settingsRef.current);
          }
        });
      });
      return (await session).getToken();
    };
    tokenProviderRef.current = getToken;
    const client = createChannelClient(nextSettings, nextSettings.profileId ? getToken : undefined);
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
    if (agent.status === "offline" || client?.getConnectionState() !== "connected") {
      dispatch({ type: "error", agentId, message: "This conversation is offline. Reconnect or choose an available agent." });
      return false;
    }
    const previous = current.messagesByAgent[agentId]?.find((message) => message.id === messageId);
    const localCreatedAt = previous?.createdAt ?? Date.now();
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

  const finishSignIn = useCallback(async (baseUrl: string, tokens: TokenResponse) => {
    const credentials = credentialsFromToken(tokens);
    const profile: InstanceProfile = { id: uid("instance"), baseUrl: instanceUrl(baseUrl),
      label: tokens.tenant.name, tenantName: tokens.tenant.name, deviceId: tokens.device.id, bindingIds: tokens.device.bindingIds };
    await saveProfile(profile, credentials);
    await updateSettings({ zakuraBaseUrl: profile.baseUrl, authToken: credentials.accessToken, profileId: profile.id,
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
      try { await revokeAuthorization(current.zakuraBaseUrl, credentials?.refreshToken ?? credentials?.accessToken ?? current.authToken); }
      catch { notice = "Signed out on this device. Zakura was unreachable; revoke the device in Zakura to end its server access."; }
    }
    if (current.profileId) await removeProfile(current.profileId);
    await updateSettings({ authToken: "", profileId: "", useMockChannel: true, onboardingComplete: false });
    setAuthNotice(notice);
  }, [updateSettings]);

  const sessionAction = useCallback(async (agentId: string, action: "status" | "start" | "stop" | "new") => {
    const scope = channelScope(settingsRef.current);
    if (!stateRef.current.agents.some((agent) => agent.id === agentId)) throw new Error("This bot is no longer authorized.");
    let session: BotSession;
    if (settingsRef.current.useMockChannel) {
      if (action === "stop" || action === "new") await clientRef.current?.interrupt?.(agentId);
      session = { agentId, bindingId: `demo-${agentId}`, sessionId: `demo-session-${agentId}`, status: "ready" };
    } else {
      const path = `/api/zakurabot/sessions/${encodeURIComponent(agentId)}`;
      const result = await request<{ session: BotSession }>(path, action === "status" ? {} : {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      session = result.session;
    }
    if (scope !== channelScope(settingsRef.current)) throw new Error("The active instance changed.");
    setSessions((previous) => ({ ...previous, [agentId]: session }));
    if (action === "stop" || action === "new") dispatch({ type: "typing", agentId, active: false });
    if (action === "new") dispatch({ type: "message", message: { id: uid("session"), agentId, kind: "system", role: "system",
      text: "New session started. Your bot now has a fresh context.", createdAt: Date.now() } });
    return session;
  }, [request, dispatch]);

  const value = useMemo<StoreValue>(() => ({
    agents: state.agents, selectedId: state.selectedId, messagesByAgent: state.messagesByAgent,
    draftsByAgent: state.draftsByAgent,
    typing: Object.fromEntries(state.agents.map((agent) => [agent.id, isAgentWorking(state, agent.id)])),
    interrupting: state.interrupting, connection: state.connection,
    connectionDetail: state.connectionDetail, settings, settingsReady, transportLabel, lastError,
    profiles, authNotice, finishSignIn, switchInstance, signOut, request, sessions, sessionAction, groups, groupsReady, updateGroups,
    requestBinary, attachmentsByAgent, addAttachments, clearAttachments, retryAttachment,
    sidebarOpen, selectAgent, setDraft, clearDraft, send, retryMessage, respondInteraction, refreshInteraction, interrupt, reconnect,
    dismissError, updateSettings, setSidebarOpen, setThreadVisible,
  }), [state, settings, settingsReady, transportLabel, lastError, sidebarOpen, selectAgent, setDraft,
    clearDraft, send, retryMessage, respondInteraction, refreshInteraction, interrupt, reconnect, dismissError, updateSettings, setThreadVisible,
    profiles, authNotice, finishSignIn, switchInstance, signOut, request, sessions, sessionAction, groups, groupsReady, updateGroups,
    requestBinary, attachmentsByAgent, addAttachments, clearAttachments, retryAttachment]);

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
