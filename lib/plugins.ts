/** Plugins marketplace + installed connections through Zakura's connection catalog API. */

export type PluginKind = "platform" | "mcp-http" | "mcp-stdio" | "skill" | "plugin";

export type PluginStatusTone = "success" | "danger" | "muted";

export interface PluginComponent {
  name: string;
  kindLabel: string;
}

export interface PluginListing {
  id: string;
  name: string;
  description: string;
  kind: PluginKind;
  source: string;
  installRef: string;
  bundledSkills: { name: string; source: string }[];
  bundledHookEvents: string[];
}

export interface PluginListingRow {
  id: string;
  name: string;
  description: string;
  kindLabel: string;
  components: PluginComponent[];
}

export interface InstalledPlugin {
  id: string;
  name: string;
  kind: PluginKind;
  status: string;
  agentIds: string[];
}

export interface InstalledRow {
  id: string;
  name: string;
  kindLabel: string;
  statusLabel: string;
  tone: PluginStatusTone;
  isInstance: boolean;
  canStart: boolean;
  canStop: boolean;
}

export interface InstallComponentResult {
  name: string;
  error: string | null;
}

export interface PluginInstallResult {
  name: string;
  status: string;
  components: InstallComponentResult[];
}

export const installedPluginsPath = () => "/api/connections";
export const installPluginPath = () => "/api/connections/install";
export const pluginSearchPath = (query: string) => `/api/connections/search?q=${encodeURIComponent(query.trim())}`;
export const connectionPath = (id: string) => `/api/connections/${encodeURIComponent(id)}`;
export const connectionActionPath = (id: string, action: "start" | "stop") =>
  `/api/connections/${encodeURIComponent(id)}/${action}`;

const KINDS: PluginKind[] = ["platform", "mcp-http", "mcp-stdio", "skill", "plugin"];

function parseKind(value: unknown): PluginKind {
  return typeof value === "string" && (KINDS as string[]).includes(value) ? (value as PluginKind) : "plugin";
}

export function pluginKindLabel(kind: PluginKind): string {
  return kind === "platform" ? "Platform"
    : kind === "mcp-http" || kind === "mcp-stdio" ? "MCP server"
    : kind === "skill" ? "Skill"
    : "Plugin";
}

function parseBundledSkills(value: unknown): { name: string; source: string }[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry) => ({ name: typeof entry.name === "string" ? entry.name : "",
      source: typeof entry.source === "string" ? entry.source : "" }))
    .filter((entry) => entry.name.length > 0);
}

function parseHookEvents(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((event): event is string => typeof event === "string") : [];
}

function parseListing(value: unknown): PluginListing | null {
  const row = value as Record<string, unknown> | null;
  if (!row || typeof row.id !== "string" || typeof row.name !== "string") return null;
  const installRef = typeof row.installRef === "string" && row.installRef ? row.installRef : row.id;
  return {
    id: row.id,
    name: row.name,
    description: typeof row.description === "string" ? row.description : "",
    kind: parseKind(row.kind),
    source: typeof row.source === "string" ? row.source : "",
    installRef,
    bundledSkills: parseBundledSkills(row.bundledSkills),
    bundledHookEvents: parseHookEvents(row.bundledHookEvents),
  };
}

/** GET /api/connections/search returns { total, items }, but tolerate a bare array. */
export function parseSearchResults(value: unknown): { total: number; items: PluginListing[] } {
  const root = (value ?? null) as { total?: unknown; items?: unknown } | null;
  const rows = Array.isArray(root?.items) ? root.items : Array.isArray(value) ? value : [];
  const items = rows.map(parseListing).filter((item): item is PluginListing => item !== null);
  const total = typeof root?.total === "number" && Number.isFinite(root.total) ? root.total : items.length;
  return { total, items };
}

export function parseInstalled(value: unknown): InstalledPlugin[] {
  const rows = (value as { items?: unknown } | null)?.items;
  if (!Array.isArray(rows)) throw new Error("Zakura returned invalid plugin information.");
  return rows.map((row) => {
    const item = row as Record<string, unknown> | null;
    if (!item || typeof item.id !== "string" || typeof item.name !== "string") return null;
    return {
      id: item.id,
      name: item.name,
      kind: parseKind(item.kind),
      status: typeof item.status === "string" ? item.status : "",
      agentIds: Array.isArray(item.agentIds) ? item.agentIds.filter((id): id is string => typeof id === "string") : [],
    } satisfies InstalledPlugin;
  }).filter((row): row is InstalledPlugin => row !== null);
}

/** The detail sheet shows what a listing bundles without a second round trip. */
export function listingComponents(listing: PluginListing): PluginComponent[] {
  return [
    ...listing.bundledSkills.map((skill) => ({ name: skill.name, kindLabel: "Skill" })),
    ...listing.bundledHookEvents.map((event) => ({ name: event, kindLabel: "Hook" })),
  ];
}

export function pluginListingRow(listing: PluginListing): PluginListingRow {
  return {
    id: listing.id,
    name: listing.name,
    description: listing.description,
    kindLabel: pluginKindLabel(listing.kind),
    components: listingComponents(listing),
  };
}

export function buildInstallBody(listing: PluginListing): { source: string; kind: PluginKind } {
  return { source: listing.installRef, kind: listing.kind };
}

const STATUS_LABELS: Record<string, { label: string; tone: PluginStatusTone }> = {
  running: { label: "Running", tone: "success" },
  starting: { label: "Starting", tone: "muted" },
  stopped: { label: "Stopped", tone: "muted" },
  installed: { label: "Installed", tone: "success" },
  error: { label: "Error", tone: "danger" },
};

export function installedRowState(connection: InstalledPlugin): InstalledRow {
  const isInstance = connection.id.startsWith("instance:");
  const status = connection.status.toLowerCase();
  const meta = STATUS_LABELS[status] ?? { label: connection.status || "Unknown", tone: "muted" as PluginStatusTone };
  return {
    id: connection.id,
    name: connection.name,
    kindLabel: pluginKindLabel(connection.kind),
    statusLabel: meta.label,
    tone: meta.tone,
    isInstance,
    canStart: isInstance && (status === "stopped" || status === "error"),
    canStop: isInstance && (status === "running" || status === "starting"),
  };
}

/** POST /api/connections/install returns { result }; bundled components carry their own status. */
export function parseInstallResult(value: unknown): PluginInstallResult {
  const row = (value as { result?: unknown } | null)?.result as Record<string, unknown> | null;
  if (!row || typeof row.name !== "string") throw new Error("Zakura did not confirm the install.");
  const components: InstallComponentResult[] = [];
  const walk = (entry: unknown) => {
    const item = entry as Record<string, unknown> | null;
    if (!item || typeof item.name !== "string") return;
    const status = typeof item.status === "string" ? item.status : "";
    components.push({ name: item.name,
      error: status.startsWith("error:") ? status.slice("error:".length).trim() || "Install failed" : null });
    if (Array.isArray(item.bundled)) item.bundled.forEach(walk);
  };
  if (Array.isArray(row.bundled)) row.bundled.forEach(walk);
  return { name: row.name, status: typeof row.status === "string" ? row.status : "installed", components };
}
