export interface InstanceProfile {
  id: string; baseUrl: string; label: string; deviceId?: string; bindingIds: string[]; tenantName?: string;
}
export interface Credentials {
  accessToken: string; refreshToken?: string; expiresAt?: number; refreshExpiresAt?: number;
}
export interface DeviceAuthorization {
  device_code: string; user_code: string; verification_uri: string; verification_uri_complete: string; expires_in: number; interval: number;
}
export interface TokenResponse {
  access_token: string; refresh_token: string; expires_in: number; refresh_expires_at: string;
  device: { id: string; name: string; bindingIds: string[] }; tenant: { id: string; name: string };
}
export class ZakuraApiError extends Error {
  constructor(readonly code: string, readonly status: number, message = code) { super(message); }
}
export function instanceUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter a full Zakura URL, for example https://zakura.example.com."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || /[?#]/.test(url.href)) {
    throw new Error("Use an HTTP(S) instance URL without credentials, a query or a fragment.");
  }
  return url.href.replace(/\/+$/, "");
}
export async function zakuraRequest<T>(baseUrl: string, path: string, init: RequestInit = {}, fetcher = fetch): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 20_000);
  try {
    const response = await fetcher(`${instanceUrl(baseUrl)}${path}`, { ...init, signal: controller.signal, credentials: "omit", redirect: "error",
      headers: { Accept: "application/json", ...init.headers } });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new ZakuraApiError(typeof body.error === "string" ? body.error : "request_failed", response.status,
      typeof body.error_description === "string" ? body.error_description : typeof body.error === "string" ? body.error : `Zakura returned ${response.status}.`);
    return body as T;
  } finally { clearTimeout(timer); init.signal?.removeEventListener("abort", abort); }
}
const json = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
export async function startAuthorization(baseUrl: string, name: string, signal?: AbortSignal): Promise<DeviceAuthorization> {
  const grant = await zakuraRequest<DeviceAuthorization>(baseUrl, "/api/zakurabot/oauth/device-code", json({ name }, signal));
  const target = new URL(grant.verification_uri_complete);
  if (target.origin !== new URL(instanceUrl(baseUrl)).origin || target.username || target.password ||
    typeof grant.device_code !== "string" || typeof grant.user_code !== "string" ||
    !Number.isFinite(grant.expires_in) || grant.expires_in <= 0 || !Number.isFinite(grant.interval) || grant.interval < 1) {
    throw new Error("Zakura returned an invalid authorization request.");
  }
  return grant;
}
export const pollAuthorization = (baseUrl: string, code: string, signal?: AbortSignal) =>
  zakuraRequest<TokenResponse>(baseUrl, "/api/zakurabot/oauth/token", json({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: code }, signal));
export const refreshAuthorization = (baseUrl: string, token: string) =>
  zakuraRequest<TokenResponse>(baseUrl, "/api/zakurabot/oauth/token", json({ grant_type: "refresh_token", refresh_token: token }));
export const revokeAuthorization = (baseUrl: string, token: string) =>
  zakuraRequest(baseUrl, "/api/zakurabot/oauth/revoke", json({ token }));
export function credentialsFromToken(response: TokenResponse, now = Date.now()): Credentials {
  if (!response.access_token || !response.refresh_token || !Number.isFinite(response.expires_in) || response.expires_in <= 0 ||
    !Number.isFinite(Date.parse(response.refresh_expires_at)) || !response.device?.id || !Array.isArray(response.device.bindingIds) || !response.tenant?.name) {
    throw new Error("Zakura returned invalid credentials. Please sign in again.");
  }
  return { accessToken: response.access_token, refreshToken: response.refresh_token,
    expiresAt: now + response.expires_in * 1000, refreshExpiresAt: Date.parse(response.refresh_expires_at) };
}
/** WS/API requests share one refresh, preserving the device's conversation identity. */
export class CredentialSession {
  private refreshing?: Promise<string>;
  constructor(private credentials: Credentials, private refresh: (token: string) => Promise<TokenResponse>,
    private persist: (credentials: Credentials) => Promise<void>, private now = Date.now) {}
  getToken(force = false): Promise<string> {
    if (this.refreshing) return this.refreshing;
    const current = this.credentials;
    if (!current.refreshToken || (!force && (current.expiresAt ?? Infinity) > this.now() + 60_000)) return Promise.resolve(current.accessToken);
    if ((current.refreshExpiresAt ?? Infinity) <= this.now()) return Promise.reject(new Error("Your Zakura login expired. Sign in again."));
    this.refreshing = (async () => {
      const next = credentialsFromToken(await this.refresh(current.refreshToken!), this.now());
      this.credentials = next;
      await this.persist(next);
      return next.accessToken;
    })().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
}
