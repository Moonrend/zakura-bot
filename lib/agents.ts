import { zakuraRequest } from "./auth";
import type { Agent } from "./types";

/** Agent management through Zakura's standard tenant API; the account's own permissions apply. */
export interface ManagedAgent {
  id: string; name: string; slug: string; description: string;
  enableComputer: boolean; enableMemory: boolean;
  spaceId?: string | null; spaceName?: string | null;
}
export interface AgentDraft {
  name?: string; description?: string; enableComputer?: boolean; enableMemory?: boolean;
  createApiKey?: boolean;
  spaceId?: string;
  avatarColor?: string;
  avatarShape?: string;
  avatarUrl?: string;
}
export interface SpaceInfo { id: string; name: string; slug: string; agentCount: number }
export const agentsPath = (spaceId?: string) =>
  spaceId ? `/api/agents?spaceId=${encodeURIComponent(spaceId)}` : "/api/agents";
export const agentPath = (agentId: string) => `/api/agents/${encodeURIComponent(agentId)}`;
export const spacesPath = () => "/api/zakurabot/spaces";

function serializeShape(value: unknown): ManagedAgent {
  const agent = value as Partial<ManagedAgent> | null;
  if (!agent || typeof agent.id !== "string" || typeof agent.name !== "string") {
    throw new Error("Zakura returned invalid agent information.");
  }
  return { id: agent.id, name: agent.name, slug: typeof agent.slug === "string" ? agent.slug : "",
    description: typeof agent.description === "string" ? agent.description : "",
    enableComputer: agent.enableComputer === true, enableMemory: agent.enableMemory === true,
    spaceId: typeof agent.spaceId === "string" ? agent.spaceId : null,
    spaceName: typeof agent.spaceName === "string" ? agent.spaceName : null };
}

export function parseSpaceList(value: unknown): SpaceInfo[] {
  // /api/zakurabot/spaces returns { spaces }, /api/spaces returns a bare array.
  const rows = Array.isArray(value) ? value : (value as { spaces?: unknown } | null)?.spaces;
  if (!Array.isArray(rows)) return []; // 旧服务端无 spaces 字段：视为单 space，隐藏选择器
  return rows.filter((s): s is SpaceInfo =>
    Boolean(s) && typeof (s as SpaceInfo).id === "string" && typeof (s as SpaceInfo).name === "string")
    .map((s) => ({ id: s.id, name: s.name, slug: typeof s.slug === "string" ? s.slug : "",
      agentCount: typeof s.agentCount === "number" ? s.agentCount : 0 }));
}

export const listSpaces = (baseUrl: string, token: string): Promise<SpaceInfo[]> =>
  zakuraRequest<unknown>(baseUrl, spacesPath(), { headers: { Authorization: `Bearer ${token}` } }).then(parseSpaceList);

/** Default space is the tenant's slug-`default` space, else the first one returned. */
export function defaultSpaceId(spaces: SpaceInfo[]): string | null {
  return (spaces.find((space) => space.slug === "default") ?? spaces[0])?.id ?? null;
}

/** Restore a saved selection when it still exists, otherwise fall back to the default/first space. */
export function resolveSpaceId(spaces: SpaceInfo[], savedId?: string | null): string | null {
  return savedId && spaces.some((space) => space.id === savedId) ? savedId : defaultSpaceId(spaces);
}

/** Agents without a spaceId (older servers) stay visible in every space. */
export function filterAgentsBySpace(agents: Agent[], spaceId?: string | null): Agent[] {
  if (!spaceId || !agents.some((agent) => agent.spaceId)) return agents;
  return agents.filter((agent) => !agent.spaceId || agent.spaceId === spaceId);
}

/** Group the roster by its space, keeping roster order within each space. */
export function groupAgentsBySpace(agents: Agent[]): { id: string; name: string; agents: Agent[] }[] {
  const groups: { id: string; name: string; agents: Agent[] }[] = [];
  for (const agent of agents) {
    const id = agent.spaceId ?? "";
    let group = groups.find((row) => row.id === id);
    if (!group) { group = { id, name: agent.spaceName || "Default", agents: [] }; groups.push(group); }
    group.agents.push(agent);
  }
  return groups;
}

/** Client-side guard before a create/update request; mirrors the server's 120-char limit. */
export function agentNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a name for this agent.";
  if (trimmed.length > 120) return "Names are limited to 120 characters.";
  return null;
}

export function parseAgentDetail(value: unknown): ManagedAgent {
  return serializeShape(value);
}

export function parseAgentList(value: unknown): ManagedAgent[] {
  if (!Array.isArray(value)) throw new Error("Zakura returned invalid agent information.");
  return value.map(serializeShape);
}

/** GET /api/me 的关键部分：角色决定 App 内的管理能力。 */
export interface AccountInfo {
  canManage: boolean;
  tenantName: string;
  userName: string;
}
export const mePath = () => "/api/me";

export function parseAccountInfo(value: unknown): AccountInfo {
  const me = value as { role?: unknown; user?: { name?: unknown; email?: unknown }; tenant?: { name?: unknown } } | null;
  if (!me || typeof me.role !== "string") throw new Error("Zakura returned invalid account information.");
  const name = me.user && typeof me.user.name === "string" ? me.user.name : "";
  const email = me.user && typeof me.user.email === "string" ? me.user.email : "";
  return { canManage: me.role === "admin" || me.role === "owner",
    tenantName: typeof me.tenant?.name === "string" ? me.tenant.name : "",
    userName: name || email };
}
