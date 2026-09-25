import { createAuthorizationProof } from "./authorization-proof";

export interface InstanceProfile {
  id: string; baseUrl: string; label: string;
  /** OAuth 动态注册的公共客户端 id（每实例一份）。 */
  clientId?: string; tenantName?: string;
}
export interface Credentials {
  accessToken: string; refreshToken?: string; expiresAt?: number;
}
export interface OAuthTokens {
  access_token: string; refresh_token: string; expires_in: number; scope?: string;
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
async function readZakuraResponse<T>(baseUrl: string, path: string, init: RequestInit, read: (response: Response) => Promise<T>, fetcher = fetch): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 60_000);
  try {
    const response = await fetcher(`${instanceUrl(baseUrl)}${path}`, { ...init, signal: controller.signal, credentials: "omit", redirect: "error",
      headers: { Accept: "application/json", ...init.headers } });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      throw new ZakuraApiError(typeof body.error === "string" ? body.error : "request_failed", response.status,
        typeof body.error_description === "string" ? body.error_description : typeof body.error === "string" ? body.error : `Zakura returned ${response.status}.`);
    }
    return await read(response);
  } finally { clearTimeout(timer); init.signal?.removeEventListener("abort", abort); }
}
export const zakuraRequest = <T>(baseUrl: string, path: string, init: RequestInit = {}, fetcher = fetch): Promise<T> =>
  readZakuraResponse(baseUrl, path, init, async (response) => await response.json() as T, fetcher);
export interface ZakuraBinary { blob: Blob; contentType: string; capturedAt: string | null }
export const zakuraBinaryRequest = (baseUrl: string, path: string, init: RequestInit = {}, fetcher = fetch): Promise<ZakuraBinary> =>
  readZakuraResponse(baseUrl, path, { ...init, headers: { Accept: "application/octet-stream", ...init.headers } }, async (response) => ({
    blob: await response.blob(), contentType: response.headers.get("content-type") ?? "application/octet-stream",
    capturedAt: response.headers.get("x-frame-captured-at"),
  }), fetcher);
const json = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
const form = (body: Record<string, string>, signal?: AbortSignal): RequestInit => ({ method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString(), signal });

export const OAUTH_SCOPE = "api openid profile";

/** 每实例动态注册一次公共 OAuth 客户端（PKCE，无 secret）。 */
export const registerOAuthClient = (baseUrl: string, redirectUri: string, signal?: AbortSignal) =>
  zakuraRequest<{ client_id: string }>(baseUrl, "/oauth/register", json({
    client_name: "Zakura Bot", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"], token_endpoint_auth_method: "none", scope: OAUTH_SCOPE,
  }, signal));

export interface OAuthStart {
  authorizationUrl: string; clientId: string; verifier: string; state: string; redirectUri: string;
}
export async function startOAuthLogin(baseUrl: string, clientId: string, redirectUri: string): Promise<OAuthStart> {
  const proof = await createAuthorizationProof();
  const state = proof.verifier.slice(0, 16);
  const url = new URL(`${instanceUrl(baseUrl)}/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", OAUTH_SCOPE);
  url.searchParams.set("code_challenge", proof.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return { authorizationUrl: url.href, clientId, verifier: proof.verifier, state, redirectUri };
}

/** 解析重定向回来的 URL（native openAuthSessionAsync 或 web 回调页）。 */
export function codeFromRedirect(redirectUrl: string, expectedState?: string): string {
  let url: URL;
  try { url = new URL(redirectUrl); } catch { throw new Error("Zakura returned an invalid redirect."); }
  const iss = url.searchParams.get("iss");
  if (iss) {
    try { if (new URL(iss).origin !== url.origin) throw new Error(); } catch { throw new Error("Zakura returned an invalid redirect issuer."); }
  }
  const error = url.searchParams.get("error");
  if (error) throw new Error(error === "access_denied" ? "Authorization was declined. You can start again." : `Zakura authorization failed: ${error}.`);
  if (expectedState && url.searchParams.get("state") !== expectedState) throw new Error("Zakura returned a mismatched login state.");
  const code = url.searchParams.get("code");
  if (!code) throw new Error("Zakura did not return an authorization code.");
  return code;
}

export const exchangeOAuthCode = (baseUrl: string, input: { code: string; verifier: string; clientId: string; redirectUri: string },
  signal?: AbortSignal) =>
  zakuraRequest<OAuthTokens>(baseUrl, "/token", form({
    grant_type: "authorization_code", code: input.code, code_verifier: input.verifier,
    client_id: input.clientId, redirect_uri: input.redirectUri,
  }, signal));
export const refreshOAuthToken = (baseUrl: string, refreshToken: string, clientId: string) =>
  zakuraRequest<OAuthTokens>(baseUrl, "/token", form({
    grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId,
  }));
export const revokeOAuthToken = (baseUrl: string, token: string) =>
  zakuraRequest(baseUrl, "/token/revoke", form({ token }));

export function tokensFromOAuth(response: OAuthTokens, now = Date.now()): Credentials {
  if (!response.access_token || !response.refresh_token || !Number.isFinite(response.expires_in) || response.expires_in <= 0) {
    throw new Error("Zakura returned invalid credentials. Please sign in again.");
  }
  return { accessToken: response.access_token, refreshToken: response.refresh_token, expiresAt: now + response.expires_in * 1000 };
}

/** WS/API requests share one refresh, preserving the user's identity. */
export class CredentialSession {
  private refreshing?: Promise<string>;
  constructor(private credentials: Credentials, private refresh: (token: string) => Promise<OAuthTokens>,
    private persist: (credentials: Credentials) => Promise<void>, private now = Date.now) {}
  getToken(force = false): Promise<string> {
    if (this.refreshing) return this.refreshing;
    const current = this.credentials;
    if (!current.refreshToken || (!force && (current.expiresAt ?? Infinity) > this.now() + 60_000)) return Promise.resolve(current.accessToken);
    this.refreshing = (async () => {
      const next = tokensFromOAuth(await this.refresh(current.refreshToken!), this.now());
      this.credentials = next;
      await this.persist(next);
      return next.accessToken;
    })().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
}
