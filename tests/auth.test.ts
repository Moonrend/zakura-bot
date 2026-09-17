import assert from "node:assert/strict";
import { test } from "node:test";
import { CredentialSession, credentialsFromToken, instanceUrl, zakuraRequest, ZakuraApiError, type TokenResponse } from "../lib/auth.js";

const tokens = (access = "new-token"): TokenResponse => ({ access_token: access, refresh_token: "new-refresh", expires_in: 1800,
  refresh_expires_at: new Date(99_999_999).toISOString(), device: { id: "device-1", name: "Phone", bindingIds: ["binding-1"] }, tenant: { id: "tenant", name: "Work" } });
test("normalizes instance prefixes and refuses credential-bearing or ambiguous login URLs", () => {
  assert.equal(instanceUrl(" https://zakura.example/prefix/// "), "https://zakura.example/prefix");
  for (const url of ["javascript:alert(1)", "https://user:pass@zakura.example", "https://zakura.example?token=secret", "https://zakura.example#", "zakura.example"]) {
    assert.throws(() => instanceUrl(url));
  }
});
test("concurrent callers rotate once, persist the refresh token, and keep separate instances isolated", async () => {
  const saved: string[] = [];
  let refreshes = 0;
  const session = new CredentialSession({ accessToken: "old", refreshToken: "refresh", expiresAt: 0 }, async (token) => {
    assert.equal(token, "refresh"); refreshes += 1; await Promise.resolve(); return tokens();
  }, async (credentials) => { saved.push(credentials.refreshToken!); }, () => 1000);
  const other = new CredentialSession({ accessToken: "other-instance" }, async () => { throw new Error("must not refresh"); }, async () => {}, () => 1000);
  assert.deepEqual(await Promise.all([session.getToken(), session.getToken(), other.getToken()]), ["new-token", "new-token", "other-instance"]);
  assert.equal(refreshes, 1);
  assert.deepEqual(saved, ["new-refresh"]);
  assert.equal(await session.getToken(), "new-token");
  assert.equal(refreshes, 1);
});
test("expired and rejected credentials cannot silently become an authenticated session", async () => {
  assert.throws(() => credentialsFromToken({ ...tokens(), expires_in: 0 }));
  const session = new CredentialSession({ accessToken: "expired", refreshToken: "refresh", expiresAt: 0, refreshExpiresAt: 1 },
    async () => tokens(), async () => {}, () => 1000);
  await assert.rejects(session.getToken(), /expired/);
  await assert.rejects(zakuraRequest("https://zakura.example/prefix", "/api/test", {}, async (url, options) => {
    assert.equal(url, "https://zakura.example/prefix/api/test");
    assert.equal(options?.redirect, "error");
    assert.equal(options?.credentials, "omit");
    return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
  }), (error: unknown) => error instanceof ZakuraApiError && error.code === "invalid_grant");
});
