/** Remote platform channels (Slack, Discord, …) bound to an agent. */

export const remoteChannelsPath = () => "/api/remote-channels";
export const remoteChannelPath = (bindingId: string) => `/api/remote-channels/${encodeURIComponent(bindingId)}`;
export const connectorsPath = () => "/api/connectors";

export interface RemoteChannelSettings {
  allowAll?: boolean;
  allowedUsers?: string[];
  allowedEmails?: string[];
  allowDMs?: boolean;
  model?: string;
  modelRouteId?: string | null;
}
export interface RemoteBindingView {
  id: string; agentId: string; platform: string; profileKey: string; label: string;
  enabled: boolean; settings: RemoteChannelSettings; credentialsEnabled: boolean;
  configuredFields: string[]; createdAt: string; updatedAt: string;
}
export interface RemoteChannelsSnapshot {
  platforms: string[]; initialized: boolean; webhookBaseUrl: string; bindings: RemoteBindingView[];
}

export type ConnectorFieldType = "text" | "secret" | "url" | "textarea" | "select" | "boolean";
export interface ConnectorField {
  key: string; label: string; type: ConnectorFieldType;
  required?: boolean; placeholder?: string; help?: string;
  options?: { value: string; label: string }[]; defaultValue?: string;
}
export interface ConnectorAuthSpec {
  kind: string; profile: string; fields: ConnectorField[]; docsUrl?: string;
}
export interface ConnectorSummary { ref: string; name: string; auth: ConnectorAuthSpec }

export type ChannelRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

const FIELD_TYPES: readonly ConnectorFieldType[] = ["text", "secret", "url", "textarea", "select", "boolean"];

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseSettings(value: unknown): RemoteChannelSettings {
  const raw = asRecord(value);
  const settings: RemoteChannelSettings = {};
  if (raw.allowAll === true) settings.allowAll = true;
  if (raw.allowDMs === true) settings.allowDMs = true;
  const users = Array.isArray(raw.allowedUsers) ? raw.allowedUsers.filter((item): item is string => typeof item === "string") : [];
  if (users.length) settings.allowedUsers = users;
  const emails = Array.isArray(raw.allowedEmails) ? raw.allowedEmails.filter((item): item is string => typeof item === "string") : [];
  if (emails.length) settings.allowedEmails = emails;
  if (typeof raw.model === "string" && raw.model) settings.model = raw.model;
  if (typeof raw.modelRouteId === "string") settings.modelRouteId = raw.modelRouteId;
  return settings;
}

function parseBinding(value: unknown): RemoteBindingView {
  const binding = asRecord(value);
  if (typeof binding.id !== "string" || typeof binding.agentId !== "string" || typeof binding.platform !== "string") {
    throw new Error("Zakura returned invalid channel information.");
  }
  return {
    id: binding.id,
    agentId: binding.agentId,
    platform: binding.platform,
    profileKey: typeof binding.profileKey === "string" ? binding.profileKey : "",
    label: typeof binding.label === "string" ? binding.label : "",
    enabled: binding.enabled === true,
    settings: parseSettings(binding.settings),
    credentialsEnabled: binding.credentialsEnabled === true,
    configuredFields: Array.isArray(binding.configuredFields)
      ? binding.configuredFields.filter((item): item is string => typeof item === "string") : [],
    createdAt: typeof binding.createdAt === "string" ? binding.createdAt : "",
    updatedAt: typeof binding.updatedAt === "string" ? binding.updatedAt : "",
  };
}

export function parseRemoteChannels(value: unknown): RemoteChannelsSnapshot {
  const raw = asRecord(value);
  if (!Array.isArray(raw.bindings)) throw new Error("Zakura returned invalid channel information.");
  return {
    platforms: Array.isArray(raw.platforms) ? raw.platforms.filter((item): item is string => typeof item === "string") : [],
    initialized: raw.initialized === true,
    webhookBaseUrl: typeof raw.webhookBaseUrl === "string" ? raw.webhookBaseUrl : "",
    bindings: raw.bindings.map(parseBinding),
  };
}

function parseField(value: unknown): ConnectorField | null {
  const field = asRecord(value);
  if (typeof field.key !== "string" || !field.key) return null;
  const rawType = typeof field.type === "string" ? field.type : "text";
  const type = (FIELD_TYPES as readonly string[]).includes(rawType) ? rawType as ConnectorFieldType : "text";
  const options = Array.isArray(field.options)
    ? field.options.map((option) => {
        const entry = asRecord(option);
        return typeof entry.value === "string"
          ? { value: entry.value, label: typeof entry.label === "string" ? entry.label : entry.value } : null;
      }).filter((option): option is { value: string; label: string } => option !== null)
    : undefined;
  return {
    key: field.key,
    label: typeof field.label === "string" && field.label ? field.label : field.key,
    type,
    ...(field.required === true ? { required: true } : {}),
    ...(typeof field.placeholder === "string" ? { placeholder: field.placeholder } : {}),
    ...(typeof field.help === "string" ? { help: field.help } : {}),
    ...(options?.length ? { options } : {}),
    ...(typeof field.defaultValue === "string" ? { defaultValue: field.defaultValue } : {}),
  };
}

function parseConnector(value: unknown): ConnectorSummary | null {
  const connector = asRecord(value);
  if (typeof connector.ref !== "string" || !connector.ref) return null;
  const auth = asRecord(connector.auth);
  return {
    ref: connector.ref,
    name: typeof connector.name === "string" && connector.name ? connector.name : connector.ref,
    auth: {
      kind: typeof auth.kind === "string" ? auth.kind : "none",
      profile: typeof auth.profile === "string" ? auth.profile : connector.ref,
      fields: Array.isArray(auth.fields)
        ? auth.fields.map(parseField).filter((field): field is ConnectorField => field !== null) : [],
      ...(typeof auth.docsUrl === "string" && auth.docsUrl ? { docsUrl: auth.docsUrl } : {}),
    },
  };
}

export function parseConnectors(value: unknown): ConnectorSummary[] {
  const rows = asRecord(value).connectors;
  if (!Array.isArray(rows)) return [];
  return rows.map(parseConnector).filter((connector): connector is ConnectorSummary => connector !== null);
}

export const loadChannels = (request: ChannelRequest): Promise<RemoteChannelsSnapshot> =>
  request<unknown>(remoteChannelsPath()).then(parseRemoteChannels);
export const loadConnectors = (request: ChannelRequest): Promise<ConnectorSummary[]> =>
  request<unknown>(connectorsPath()).then(parseConnectors);

/** Chat platform connectors are catalogued as `remote-{platform}`. */
export const platformConnectorRef = (platform: string) => `remote-${platform}`;

export function connectorForPlatform(connectors: ConnectorSummary[], platform: string): ConnectorSummary | null {
  const ref = platformConnectorRef(platform);
  return connectors.find((connector) => connector.ref === ref) ?? null;
}

export function platformLabel(platform: string): string {
  return platform === "zakurabot" ? "Zakura Bot" : platform;
}

export function webhookUrlFor(webhookBaseUrl: string, bindingId: string): string {
  const base = webhookBaseUrl.replace(/\/+$/, "");
  return base ? `${base}/${encodeURIComponent(bindingId)}/webhook` : "";
}

function joinLabels(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** Plain guidance derived only from the connector's declared field labels. */
export function credentialHint(fields: ConnectorField[]): string {
  if (!fields.length) return "No credentials are required.";
  const required = fields.filter((field) => field.required).map((field) => field.label);
  return required.length ? `Requires ${joinLabels(required)}.` : `Optional: ${joinLabels(fields.map((field) => field.label))}.`;
}

export type ChannelState = "available" | "connected" | "disabled" | "incomplete";
export interface ChannelRow {
  platform: string; name: string; binding: RemoteBindingView | null; state: ChannelState;
  stateLabel: string; credentialSummary: string; fields: ConnectorField[];
  docsUrl?: string; webhookUrl: string | null;
}

export function missingCredentialFields(fields: ConnectorField[], configured: string[]): string[] {
  return fields.filter((field) => field.required && !configured.includes(field.key)).map((field) => field.label);
}

function stateFor(binding: RemoteBindingView | null, fields: ConnectorField[]): ChannelState {
  if (!binding) return "available";
  if (!binding.enabled) return "disabled";
  return missingCredentialFields(fields, binding.configuredFields).length ? "incomplete" : "connected";
}

export function channelStateLabel(state: ChannelState): string {
  return state === "available" ? "Not connected"
    : state === "disabled" ? "Disabled"
    : state === "incomplete" ? "Needs credentials" : "Connected";
}

function credentialSummary(binding: RemoteBindingView | null, fields: ConnectorField[]): string {
  if (!binding) return "";
  if (!fields.length) return "No credentials required";
  const missing = missingCredentialFields(fields, binding.configuredFields);
  if (missing.length) return `Missing ${joinLabels(missing)}`;
  const set = fields.filter((field) => binding.configuredFields.includes(field.key)).length;
  if (set === 0) return "No credentials set";
  return set === fields.length ? "All credentials set" : `${set} of ${fields.length} credentials set`;
}

/** One row per platform, with any binding for `agentId` attached; also surfaces bindings on unlisted platforms. */
export function buildChannelRows(
  platforms: string[], bindings: RemoteBindingView[], connectors: ConnectorSummary[],
  agentId: string, webhookBaseUrl: string,
): ChannelRow[] {
  const agentBindings = bindings.filter((binding) => binding.agentId === agentId && binding.platform !== "email");
  const ordered = [...platforms];
  for (const binding of agentBindings) if (!ordered.includes(binding.platform)) ordered.push(binding.platform);
  return ordered.map((platform) => {
    const binding = agentBindings.find((row) => row.platform === platform) ?? null;
    const connector = connectorForPlatform(connectors, platform);
    const fields = connector?.auth.fields ?? [];
    const state = stateFor(binding, fields);
    return {
      platform,
      name: connector?.name ?? platformLabel(platform),
      binding,
      state,
      stateLabel: channelStateLabel(state),
      credentialSummary: credentialSummary(binding, fields),
      fields,
      ...(connector?.auth.docsUrl ? { docsUrl: connector.auth.docsUrl } : {}),
      webhookUrl: binding && platform !== "zakurabot" ? webhookUrlFor(webhookBaseUrl, binding.id) : null,
    };
  });
}

/** Placeholder the server treats as "keep the stored value". */
export const KEEP_CREDENTIAL = "***";

/**
 * Submit only fields the form tracks and that changed. `undefined`/`***` keep the
 * existing value; `""` deletes a configured field; anything else replaces it.
 */
export function buildCredentialPayload(
  fields: ConnectorField[], drafts: Record<string, string>, configured: string[] = [],
): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const field of fields) {
    const value = drafts[field.key];
    if (value === undefined || value === KEEP_CREDENTIAL) continue;
    if (value === "" && !configured.includes(field.key)) continue;
    payload[field.key] = value;
  }
  return payload;
}

/** Required labels that are neither already saved nor supplied in this payload. */
export function missingRequiredCredentials(
  fields: ConnectorField[], payload: Record<string, string>, configured: string[] = [],
): string[] {
  return fields.filter((field) => field.required && !configured.includes(field.key) && !(payload[field.key] ?? "").trim())
    .map((field) => field.label);
}
