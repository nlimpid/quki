/**
 * Session JWT check for the Worker.
 *
 * `@clerk/backend@3.30.0` `verifyToken` loads a key only from `jwtKey` (a static PEM)
 * or `secretKey` (Clerk Backend API `https://api.clerk.com/v1/jwks`). The secret key
 * is an account admin credential. The public JWKS is `{issuer}/.well-known/jwks.json`
 * as documented in https://clerk.com/docs/guides/sessions/manual-jwt-verification.
 * This module fetches that URL from the configured issuer only, caches it, and
 * refetches when the key id is unknown or the cache is older than ten minutes.
 * The token's `iss` is never used as a fetch URL.
 *
 * Claim rules match packages/backend/src/jwt/assertions.ts and jwtCategories.ts
 * at tag @clerk/backend@3.30.0. Session tokens must carry header cat
 * `cl_B7d4PD111AAA`. If Clerk changes that category, verification must fail
 * closed. A missing or different category is not a session token.
 */

const SESSION_CATEGORY = "cl_B7d4PD111AAA";
const ALLOWED_ALGS = ["RS256", "RS384", "RS512"] as const;
const CLOCK_SKEW_MS = 5_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

export type ClerkVerifyConfig = {
  /** Exact https origin, for example https://your-instance.clerk.accounts.dev */
  issuer: string;
  authorizedParties: readonly string[];
  /** Test double. Production uses the Worker fetch and the configured issuer only. */
  fetchJwks?: typeof fetch;
};

export type ClerkVerifyFailure =
  | "unconfigured"
  | "malformed"
  | "session-type"
  | "algorithm"
  | "signature"
  | "issuer"
  | "audience"
  | "authorized-party"
  | "expired"
  | "not-before"
  | "issued-at"
  | "jwks";

export type ClerkVerified = { ok: true; issuer: string; subject: string };
export type ClerkRejected = { ok: false; reason: ClerkVerifyFailure };

type VerifyKey = Awaited<ReturnType<(typeof crypto.subtle)["importKey"]>>;
type CacheEntry = { fetchedAt: number; byKid: Map<string, VerifyKey> };

const cache = new Map<string, CacheEntry>();

export function clearClerkJwksCache(): void {
  cache.clear();
}

export function readClerkEnv(env: {
  CLERK_JWT_ISSUER?: string;
  CLERK_AUTHORIZED_PARTIES?: string;
}): ClerkVerifyConfig | null {
  const issuerText = env.CLERK_JWT_ISSUER?.trim() ?? "";
  if (!issuerText) return null;
  let url: URL;
  try {
    url = new URL(issuerText);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  const parties = (env.CLERK_AUTHORIZED_PARTIES ?? "https://quki.cc,https://www.quki.cc")
    .split(",")
    .map((item) => partyOrigin(item.trim()))
    .filter((item): item is string => item != null);
  const rawCount = (env.CLERK_AUTHORIZED_PARTIES ?? "https://quki.cc,https://www.quki.cc")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0).length;
  if (parties.length === 0 || parties.length !== rawCount) return null;
  return { issuer: url.origin, authorizedParties: parties };
}

function partyOrigin(value: string): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (value !== url.origin) return null;
  if (url.protocol === "https:") return url.origin;
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "http:" && local) return url.origin;
  return null;
}

function acceptedAudience(value: unknown, config: ClerkVerifyConfig): boolean {
  if (value == null) return true;
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
  if (!values || values.length === 0) return false;
  return values.every(
    (item) =>
      typeof item === "string" &&
      (item === config.issuer || config.authorizedParties.includes(item)),
  );
}

export function jwksUrlForIssuer(issuer: string): string {
  const url = new URL(issuer);
  if (url.protocol !== "https:" || url.origin !== issuer) throw new Error("issuer");
  return `${url.origin}/.well-known/jwks.json`;
}

export function bearerFromAuthorization(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(header.trim());
  return match?.[1] ?? null;
}

type JwtParts = {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array;
};

function decode(token: string): JwtParts | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) return null;
  try {
    const header = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(parts[0] ?? "")),
    ) as unknown;
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(parts[1] ?? "")),
    ) as unknown;
    if (!header || typeof header !== "object" || Array.isArray(header)) return null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    return {
      header: header as Record<string, unknown>,
      payload: payload as Record<string, unknown>,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: base64UrlToBytes(parts[2] ?? ""),
    };
  } catch {
    return null;
  }
}

export async function verifyClerkSessionToken(
  token: string,
  config: ClerkVerifyConfig | null,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<ClerkVerified | ClerkRejected> {
  if (!config) return { ok: false, reason: "unconfigured" };
  fetchImpl = config.fetchJwks ?? fetchImpl;
  const jwt = decode(token);
  if (!jwt) return { ok: false, reason: "malformed" };
  if (jwt.header.cat !== SESSION_CATEGORY) return { ok: false, reason: "session-type" };
  const alg = jwt.header.alg;
  if (typeof alg !== "string" || !ALLOWED_ALGS.includes(alg as (typeof ALLOWED_ALGS)[number])) {
    return { ok: false, reason: "algorithm" };
  }
  const kid = typeof jwt.header.kid === "string" ? jwt.header.kid : "";
  if (!kid) return { ok: false, reason: "jwks" };
  let keys: Map<string, VerifyKey>;
  try {
    keys = await keysFor(config.issuer, fetchImpl, false, now);
    if (!keys.has(kid)) keys = await keysFor(config.issuer, fetchImpl, true, now);
  } catch {
    return { ok: false, reason: "jwks" };
  }
  const key = keys.get(kid);
  if (!key) return { ok: false, reason: "jwks" };
  const hash = alg === "RS256" ? "SHA-256" : alg === "RS384" ? "SHA-384" : "SHA-512";
  const signature = new ArrayBuffer(jwt.signature.byteLength);
  new Uint8Array(signature).set(jwt.signature);
  const signed = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5", hash },
    key,
    signature,
    new TextEncoder().encode(jwt.signingInput),
  );
  if (!signed) return { ok: false, reason: "signature" };
  if (jwt.payload.iss !== config.issuer) return { ok: false, reason: "issuer" };
  if (!acceptedAudience(jwt.payload.aud, config)) return { ok: false, reason: "audience" };
  const azp = jwt.payload.azp;
  if (typeof azp !== "string" || !config.authorizedParties.includes(azp)) {
    return { ok: false, reason: "authorized-party" };
  }
  const exp = jwt.payload.exp;
  const nbf = jwt.payload.nbf;
  const iat = jwt.payload.iat;
  if (typeof exp !== "number" || exp * 1000 <= now - CLOCK_SKEW_MS)
    return { ok: false, reason: "expired" };
  if (typeof nbf === "number" && nbf * 1000 > now + CLOCK_SKEW_MS)
    return { ok: false, reason: "not-before" };
  if (nbf != null && typeof nbf !== "number") return { ok: false, reason: "not-before" };
  if (typeof iat === "number" && iat * 1000 > now + CLOCK_SKEW_MS)
    return { ok: false, reason: "issued-at" };
  if (iat != null && typeof iat !== "number") return { ok: false, reason: "issued-at" };
  if (typeof jwt.payload.sub !== "string" || jwt.payload.sub.length === 0)
    return { ok: false, reason: "malformed" };
  return { ok: true, issuer: config.issuer, subject: jwt.payload.sub };
}

async function keysFor(
  issuer: string,
  fetchImpl: typeof fetch,
  force: boolean,
  now: number,
): Promise<Map<string, VerifyKey>> {
  const cached = cache.get(issuer);
  if (!force && cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.byKid;
  const url = jwksUrlForIssuer(issuer);
  if (new URL(url).origin !== issuer) throw new Error("jwks-origin");
  const response = await fetchImpl(url, { method: "GET" });
  if (new URL(response.url || url).origin !== issuer) throw new Error("jwks-redirect");
  if (!response.ok) throw new Error("jwks-status");
  const body = (await response.json()) as { keys?: unknown };
  if (!Array.isArray(body.keys)) throw new Error("jwks-shape");
  const byKid = new Map<string, VerifyKey>();
  for (const jwk of body.keys) {
    if (!jwk || typeof jwk !== "object") continue;
    const record = jwk as { kid?: string; kty?: string; alg?: string };
    if (typeof record.kid !== "string" || record.kty !== "RSA") continue;
    const hash =
      record.alg === "RS384" ? "SHA-384" : record.alg === "RS512" ? "SHA-512" : "SHA-256";
    const key = await crypto.subtle.importKey(
      "jwk",
      record,
      { name: "RSASSA-PKCS1-v1_5", hash },
      false,
      ["verify"],
    );
    byKid.set(record.kid, key);
  }
  cache.set(issuer, { fetchedAt: now, byKid });
  return byKid;
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded =
    value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
