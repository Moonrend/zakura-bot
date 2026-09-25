/** Agent management through Zakura's standard tenant API; the account's own permissions apply. */
export interface ManagedAgent {
  id: string; name: string; slug: string; description: string;
  enableComputer: boolean; enableMemory: boolean;
}
export interface AgentDraft {
  name?: string; description?: string; enableComputer?: boolean; enableMemory?: boolean;
}
export const agentsPath = () => "/api/agents";
export const agentPath = (agentId: string) => `/api/agents/${encodeURIComponent(agentId)}`;

function serializeShape(value: unknown): ManagedAgent {
  const agent = value as Partial<ManagedAgent> | null;
  if (!agent || typeof agent.id !== "string" || typeof agent.name !== "string") {
    throw new Error("Zakura returned invalid agent information.");
  }
  return { id: agent.id, name: agent.name, slug: typeof agent.slug === "string" ? agent.slug : "",
    description: typeof agent.description === "string" ? agent.description : "",
    enableComputer: agent.enableComputer === true, enableMemory: agent.enableMemory === true };
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
