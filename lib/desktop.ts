export interface DesktopInfo {
  enabled: boolean; supported: boolean; status?: string; width?: number; height?: number; suggestedIntervalMs: number;
}
export const desktopPath = (agentId: string, frame = false) => `/api/zakurabot/agents/${encodeURIComponent(agentId)}/desktop${frame ? "/frame" : ""}`;

export function parseDesktopInfo(value: unknown): DesktopInfo {
  const info = value as Partial<DesktopInfo> | null;
  if (!info || typeof info.enabled !== "boolean" || typeof info.supported !== "boolean") throw new Error("Zakura returned invalid desktop information.");
  const dimension = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 32768 ? value : undefined;
  return { enabled: info.enabled, supported: info.supported, status: typeof info.status === "string" ? info.status : undefined,
    width: dimension(info.width), height: dimension(info.height), suggestedIntervalMs: typeof info.suggestedIntervalMs === "number" && Number.isFinite(info.suggestedIntervalMs)
      ? Math.min(30_000, Math.max(2000, info.suggestedIntervalMs)) : 2000 };
}

export type DesktopPhase = "off" | "starting" | "running";

const STARTING_STATUSES = new Set(["starting", "created", "restarting", "paused", "removing", "stopping"]);
const OFFLINE_STATUSES = new Set(["off", "offline", "idle", "unbound", "none", "exited", "dead", "stopped", "removed"]);

export function workspaceOffline(status: string | null | undefined): boolean {
  return typeof status === "string" && OFFLINE_STATUSES.has(status.trim().toLowerCase());
}

export function desktopPhase(input: { status?: string | null; hasFrame: boolean; loading: boolean }): DesktopPhase {
  if (input.hasFrame) return "running";
  const status = typeof input.status === "string" ? input.status.trim().toLowerCase() : "";
  if (input.loading || status === "running" || STARTING_STATUSES.has(status)) return "starting";
  return workspaceOffline(status) ? "off" : "starting";
}
