import assert from "node:assert/strict";
import { test } from "node:test";
import { CredentialSession, codeFromRedirect, instanceUrl, tokensFromOAuth, validatePendingState, zakuraRequest, ZakuraApiError,
  type OAuthTokens } from "../lib/auth.js";

const tokens = (access = "jwt-token"): OAuthTokens => ({ access_token: access, refresh_token: "new-refresh", expires_in: 1800 });
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
  assert.deepEqual(await Promise.all([session.getToken(), session.getToken(), other.getToken()]), ["jwt-token", "jwt-token", "other-instance"]);
  assert.equal(refreshes, 1);
  assert.deepEqual(saved, ["new-refresh"]);
  assert.equal(await session.getToken(), "jwt-token");
  assert.equal(refreshes, 1);
});
test("expired credentials rotate; invalid responses never become a session", async () => {
  assert.throws(() => tokensFromOAuth({ ...tokens(), expires_in: 0 }));
  assert.throws(() => tokensFromOAuth({ ...tokens(), refresh_token: "" }));
  await assert.rejects(zakuraRequest("https://zakura.example/prefix", "/token", {}, async (url, options) => {
    assert.equal(url, "https://zakura.example/prefix/token");
    assert.equal(options?.redirect, "error");
    assert.equal(options?.credentials, "omit");
    return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
  }), (error: unknown) => error instanceof ZakuraApiError && error.code === "invalid_grant");
});
test("redirect parsing validates issuer, state and code", () => {
  const callback = "https://app.example/oauth/callback";
  const server = "https://zakura.example";
  assert.equal(codeFromRedirect(`${callback}?code=abc&state=s1&iss=${encodeURIComponent(server)}`, "s1", server), "abc");
  assert.throws(() => codeFromRedirect(`${callback}?code=abc&state=s1&iss=${encodeURIComponent("https://evil.example")}`, "s1", server), /issuer/);
  assert.equal(codeFromRedirect("zakurabot://oauth?code=abc&state=s1", "s1", server), "abc");
  assert.equal(codeFromRedirect(`zakurabot://oauth?code=abc&state=s1&iss=${encodeURIComponent("https://evil.example")}`, "s1", server), "abc");
  assert.throws(() => codeFromRedirect(`${callback}?error=access_denied&iss=${encodeURIComponent("https://evil.example")}`, "s1", server), /declined/);
  assert.throws(() => codeFromRedirect(`${callback}?code=abc&state=other`, "s1", server), /mismatched/);
  assert.throws(() => codeFromRedirect(`${callback}?state=s1`, "s1", server), /did not return/);
  assert.throws(() => codeFromRedirect("not a url"), /invalid redirect/);
});
test("same-tab callback validates the pending login state before exchanging", () => {
  assert.equal(validatePendingState("s1", "s1"), null);
  assert.match(validatePendingState("s1", "other")!, /doesn't match/);
  assert.match(validatePendingState(null, "s1")!, /doesn't match/);
  assert.match(validatePendingState("s1", null)!, /no longer available/);
});
