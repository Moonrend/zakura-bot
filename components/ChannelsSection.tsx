import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/clipboard";
import { Field } from "@/components/ui/Field";
import { ExternalLink } from "./ExternalLink";
import {
  buildChannelRows, buildCredentialPayload, credentialHint, KEEP_CREDENTIAL, loadChannels, loadConnectors,
  missingRequiredCredentials, remoteChannelPath, remoteChannelsPath,
  type ChannelRow, type ConnectorField, type ConnectorSummary, type RemoteChannelsSnapshot, type RemoteBindingView,
} from "@/lib/channels";

const NOTE = "Credentials are encrypted on the server and never shown again after you save.";
const EMPTY_COPY = "Channels let people reach this agent from Slack, Discord, and other chat platforms.";

type Draft = { row: ChannelRow; drafts: Record<string, string> };

function initialDrafts(fields: ConnectorField[], configured: string[]): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const field of fields) if (configured.includes(field.key)) drafts[field.key] = KEEP_CREDENTIAL;
  return drafts;
}

function Choice({ label, checked, disabled, onPress }: { label: string; checked: boolean; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked, disabled: !!disabled }} disabled={disabled}
    onPress={onPress} className={cn("min-h-11 justify-center rounded-lg border px-3 py-2", checked ? "border-accent bg-accent/15" : "border-hairline bg-panel", disabled && "opacity-50")}>
    <Text className="text-[13px] text-ink">{label}</Text>
  </Pressable>;
}

function Action({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
    className={cn("min-h-11 justify-center rounded-lg border border-hairline bg-panel px-3 py-2 active:bg-raised/40", disabled && "opacity-50")}>
    <Text className={cn("text-[13px] font-medium", danger ? "text-danger" : "text-ink")}>{label}</Text>
  </Pressable>;
}

function CredentialInput({ field, value, configured, onChange }: {
  field: ConnectorField; value: string; configured: boolean; onChange: (value: string) => void;
}) {
  const label = `${field.label}${field.required ? " *" : ""}`;
  const placeholder = configured ? "Saved on the server" : field.placeholder ?? field.defaultValue ?? "";
  if (field.type === "select") return <View className="gap-1">
    <Text className="pl-2.5 text-[13px] text-ink-secondary">{label}</Text>
    <View className="flex-row flex-wrap gap-2">{(field.options ?? []).map((option) =>
      <Choice key={option.value} label={option.label} checked={value === option.value} onPress={() => onChange(option.value)} />)}</View>
    {configured ? <Text className="pl-2.5 text-[12px] text-ink-secondary">Saved on the server. Choose an option to replace it.</Text>
      : field.help ? <Text className="pl-2.5 text-[12px] text-ink-secondary">{field.help}</Text> : null}
  </View>;
  if (field.type === "boolean") return <View className="gap-1">
    <Text className="pl-2.5 text-[13px] text-ink-secondary">{label}</Text>
    <View className="flex-row gap-2">{[["true", "Yes"], ["false", "No"]].map(([option, text]) =>
      <Choice key={option} label={text} checked={value === option} onPress={() => onChange(option)} />)}</View>
  </View>;
  const multiline = field.type === "textarea";
  return <View className="gap-1">
    <Field label={label} value={value} onChangeText={onChange} placeholder={placeholder}
      accessibilityLabel={field.label} secureTextEntry={field.type === "secret"} multiline={multiline}
      autoCapitalize="none" autoCorrect={false} maxLength={8000}
      style={multiline ? { minHeight: 88, textAlignVertical: "top" } : undefined} />
    {configured ? <Text className="pl-2.5 text-[12px] text-ink-secondary">Saved on the server. Replace it, or clear the field to remove it.</Text>
      : field.help ? <Text className="pl-2.5 text-[12px] text-ink-secondary">{field.help}</Text> : null}
  </View>;
}

export function ChannelsSection({ agentId, canManage }: { agentId: string; canManage: boolean }) {
  const { request, agents } = useStore();
  const [snapshot, setSnapshot] = useState<RemoteChannelsSnapshot | null>(null);
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const agentName = agents.find((agent) => agent.id === agentId)?.name || "this agent";

  const reload = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const [channels, catalog] = await Promise.all([loadChannels(request), loadConnectors(request)]);
      setSnapshot(channels); setConnectors(catalog);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "Could not load channels.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { setDraft(null); setConfirming(null); setPickerOpen(false); setActionError(null); }, [agentId]);

  const rows = useMemo(
    () => snapshot ? buildChannelRows(snapshot.platforms, snapshot.bindings, connectors, agentId, snapshot.webhookBaseUrl) : [],
    [snapshot, connectors, agentId],
  );
  const hasBindings = rows.some((row) => row.binding);
  const showList = hasBindings || pickerOpen;

  const run = async (id: string, work: () => Promise<void>) => {
    setBusy(id); setActionError(null);
    try { await work(); await reload(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "That change could not be saved."); }
    finally { setBusy(null); }
  };

  const toggle = (row: ChannelRow) => {
    if (!row.binding) return;
    void run(row.binding.id, () => request(remoteChannelPath(row.binding!.id), {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !row.binding!.enabled }),
    }));
  };

  const disconnect = (row: ChannelRow) => {
    if (!row.binding) return;
    setConfirming(null);
    void run(row.binding.id, async () => { await request(remoteChannelPath(row.binding!.id), { method: "DELETE" }); });
  };

  const save = () => {
    if (!draft) return;
    const configured = draft.row.binding?.configuredFields ?? [];
    const payload = buildCredentialPayload(draft.row.fields, draft.drafts, configured);
    const missing = missingRequiredCredentials(draft.row.fields, payload, configured);
    if (missing.length) { setActionError(missing.length === 1 ? `Enter ${missing[0]}.` : `Enter ${missing.join(", ")}.`); return; }
    const binding: RemoteBindingView | null = draft.row.binding;
    const platform = draft.row.platform;
    const id = binding?.id ?? platform;
    void run(id, async () => {
      if (binding) await request(remoteChannelPath(binding.id), {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials: payload, credentialsEnabled: true }),
      });
      else await request(remoteChannelsPath(), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, platform, enabled: true, credentials: payload, credentialsEnabled: true }),
      });
      setDraft(null);
    });
  };

  const copyWebhook = (id: string, url: string) => {
    void copyText(url).then(() => setCopied(id)).catch(() => undefined);
  };

  if (loading) return <View className="min-h-16 items-center justify-center"><ActivityIndicator color="#a8a8a8" /></View>;
  if (loadError) return <View className="gap-3 px-4 pb-4 pt-1">
    <Text accessibilityRole="alert" className="text-[13px] leading-5 text-danger">{loadError}</Text>
    <Action label="Retry" onPress={() => void reload()} />
  </View>;

  if (draft) {
    const row = draft.row;
    const configured = row.binding?.configuredFields ?? [];
    return <View className="gap-3 px-4 pb-4 pt-1">
      <Text className="text-[15px] text-ink">{row.binding ? `Edit credentials · ${row.name}` : `Connect ${row.name}`}</Text>
      <Text className="text-[13px] leading-5 text-ink-secondary">{credentialHint(row.fields)}</Text>
      {row.fields.map((field) => <CredentialInput key={field.key} field={field} value={draft.drafts[field.key] ?? ""}
        configured={configured.includes(field.key)}
        onChange={(value) => setDraft((current) => current && { ...current, drafts: { ...current.drafts, [field.key]: value } })} />)}
      {row.docsUrl ? <ExternalLink url={row.docsUrl} label="How to connect" /> : null}
      <Text className="text-[12px] leading-5 text-ink-secondary">{NOTE}</Text>
      {actionError ? <Text accessibilityRole="alert" className="text-[13px] leading-5 text-danger">{actionError}</Text> : null}
      <View className="flex-row items-center gap-3 pt-1">
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" disabled={busy !== null} onPress={() => { setDraft(null); setActionError(null); }}
          className="min-h-11 flex-1 items-center justify-center rounded-full active:bg-raised/40">
          <Text className="text-[15px] text-ink-secondary">Cancel</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={row.binding ? "Save credentials" : "Connect"} disabled={busy !== null}
          onPress={save} className={cn("min-h-11 flex-1 flex-row items-center justify-center gap-2 rounded-full bg-ink py-3 active:opacity-80", busy !== null && "opacity-60")}>
          {busy !== null ? <ActivityIndicator size="small" color="#070707" /> : null}
          <Text className="text-[15px] font-semibold text-app">{row.binding ? "Save" : "Connect"}</Text>
        </Pressable>
      </View>
    </View>;
  }

  if (!showList) {
    return <View className="gap-3 px-4 pb-4 pt-1">
      <Text className="text-[13px] leading-5 text-ink-secondary">{EMPTY_COPY}</Text>
      {canManage ? <View className="flex-row"><Action label="Connect a channel" onPress={() => setPickerOpen(true)} /></View> : null}
    </View>;
  }

  return <View className="pb-1">
    {!hasBindings ? <Text className="px-4 pb-1 pt-1 text-[13px] leading-5 text-ink-secondary">{EMPTY_COPY}</Text> : null}
    {rows.map((row) => <View key={row.platform} className="mx-4 border-b border-hairline py-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] text-ink" numberOfLines={1}>{row.binding?.label || row.name}</Text>
          {row.binding ? <Text className="mt-0.5 text-[13px] text-ink-secondary">{row.stateLabel}{row.credentialSummary ? ` · ${row.credentialSummary}` : ""}</Text>
            : <Text className="mt-0.5 text-[13px] text-ink-secondary">{row.stateLabel}</Text>}
        </View>
      </View>

      {row.webhookUrl ? <View className="mt-2 gap-1">
        <Text className="text-[12px] text-ink-secondary">Webhook URL</Text>
        <Pressable onPress={() => copyWebhook(row.binding!.id, row.webhookUrl!)} accessibilityRole="button"
          accessibilityLabel="Copy webhook URL" className="rounded-lg bg-inset px-2.5 py-2 active:bg-raised/40">
          <Text selectable className="text-[12px] leading-4 text-ink-secondary">{row.webhookUrl}</Text>
        </Pressable>
        {copied === row.binding!.id ? <Text className="text-[12px] text-ink-secondary">Copied.</Text> : null}
      </View> : null}

      {confirming === row.platform && row.binding ? <View className="mt-3">
        <Text className="text-[15px] text-ink">Disconnect {row.name}?</Text>
        <Text className="mt-1 text-[13px] leading-5 text-ink-secondary">Messages from this platform will stop going to {agentName}.</Text>
        <View className="mt-3 flex-row items-center gap-2">
          <Action label="Cancel" onPress={() => setConfirming(null)} />
          <Action label="Disconnect" danger disabled={busy !== null} onPress={() => disconnect(row)} />
        </View>
      </View> : canManage ? <View className="mt-3 flex-row flex-wrap gap-2">
        {row.binding ? <>
          {row.fields.length ? <Action label="Edit credentials" disabled={busy !== null} onPress={() => { setActionError(null); setDraft({ row, drafts: initialDrafts(row.fields, row.binding!.configuredFields) }); }} /> : null}
          <Action label={row.binding.enabled ? "Disable" : "Enable"} disabled={busy !== null} onPress={() => toggle(row)} />
          <Action label="Disconnect" danger disabled={busy !== null} onPress={() => setConfirming(row.platform)} />
        </> : <Action label="Connect" disabled={busy !== null} onPress={() => { setActionError(null); setDraft({ row, drafts: initialDrafts(row.fields, []) }); }} />}
      </View> : null}
    </View>)}

    {!canManage ? <Text className="px-4 pb-2 pt-3 text-[12px] leading-5 text-ink-secondary">Only a tenant admin can change channel connections.</Text> : null}
    {actionError ? <Text accessibilityRole="alert" className="px-4 pb-2 pt-2 text-[13px] leading-5 text-danger">{actionError}</Text> : null}
  </View>;
}
