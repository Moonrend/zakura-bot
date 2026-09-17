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
