/** Keep the verifier in memory for this login; only its SHA-256 challenge is published. */
export async function createAuthorizationProof() {
  const crypto = await import("expo-crypto");
  const verifier = Array.from(await crypto.getRandomBytesAsync(32), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: crypto.CryptoEncoding.BASE64 });
  return { verifier, challenge: digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") };
}
