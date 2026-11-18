/** Session contract for the login MVP. The browser and the site worker both use this. */

export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
export const AUTH_OAUTH_MAX_AGE_SECONDS = 60 * 10;
export const AUTH_PROBE_TIMEOUT_MS = 4_000;

export type AuthSessionUser = {
  id: string;
  /** Present only when the IdP sent a name that is not an email address or phone number. */
  displayName: string | null;
};

export type AuthLoginMethod = "oidc" | "clerk";

export type AuthUnavailableReason =
  | "auth_not_configured"
  | "storage_unconfigured"
  | "scopes_not_confirmed";

export type AuthSessionResponse = {
  status: "anonymous" | "authenticated" | "unavailable";
  authenticated: boolean;
  /** True when a session cookie was presented and the server session is expired or revoked. */
  expired: boolean;
  user: AuthSessionUser | null;
  /** Echo this on logout. It is not a session credential. Null when login is unavailable. */
  csrfToken: string | null;
  login: {
    ready: boolean;
    method: AuthLoginMethod | null;
    reason: AuthUnavailableReason | null;
  };
};

function looksLikePhone(value: string): boolean {
  const compact = value.replace(/[\s()-]/g, "");
  return /^\+?\d{6,}$/.test(compact);
}

function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

/** Name safe to show in the account menu. Email and phone numbers are not display names. */
export function publicDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 40) return null;
  if (hasControlChar(name)) return null;
  if (name.includes("@") || looksLikePhone(name)) return null;
  return name;
}

export function accountLabel(displayName?: string | null): string {
  return publicDisplayName(displayName) ?? "已登录";
}

const ENCODED_DANGER = /%2f|%5c|%3a%2f%2f/i;

/**
 * Same-origin path, search, and hash, or `/`.
 * The caller passes the `returnTo` value after the HTTP stack's single percent-decode.
 * A value that still contains `%` is decoded once more and rejected if that decode
 * leaves an encoded slash, backslash, or scheme.
 */
export function safeReturnTo(value: unknown, origin: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return "/";
  let decoded = value;
  if (value.includes("%")) {
    try {
      decoded = decodeURIComponent(value);
    } catch {
      return "/";
    }
  }
  if (ENCODED_DANGER.test(decoded)) return "/";
  if (hasControlChar(decoded)) return "/";
  if (decoded !== decoded.trim()) return "/";
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.startsWith("/\\")) return "/";
  if (decoded.includes("\\") || decoded.includes("://")) return "/";
  let base: URL;
  let target: URL;
  try {
    base = new URL(origin);
    target = new URL(decoded, base);
  } catch {
    return "/";
  }
  if (target.origin !== base.origin) return "/";
  if (target.pathname === "/login" || target.pathname.startsWith("/login/")) return "/";
  const hash = target.hash === "#" ? "" : target.hash;
  const next = `${target.pathname}${target.search}${hash}`;
  if (!next.startsWith("/") || next.startsWith("//") || next.length > 512) return "/";
  return next;
}

function parseUser(value: unknown): AuthSessionUser | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as { id?: unknown }).id;
  if (typeof id !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(id)) return null;
  return { id, displayName: publicDisplayName((value as { displayName?: unknown }).displayName) };
}

/** Drops email, phone, tokens, and any other fields the server must not display. */
export function parseAuthSessionResponse(value: unknown): AuthSessionResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const status = body.status;
  if (status !== "anonymous" && status !== "authenticated" && status !== "unavailable") return null;
  if (typeof body.authenticated !== "boolean") return null;
  if (body.authenticated !== (status === "authenticated")) return null;
  const user = body.user == null ? null : parseUser(body.user);
  if (body.user != null && !user) return null;
  if (body.authenticated && !user) return null;
  if (!body.authenticated && user) return null;
  if (body.csrfToken != null && typeof body.csrfToken !== "string") return null;
  const csrfToken =
    typeof body.csrfToken === "string" && body.csrfToken.length > 0 ? body.csrfToken : null;
  if (body.authenticated && !csrfToken) return null;
  if (!body.login || typeof body.login !== "object" || Array.isArray(body.login)) return null;
  const login = body.login as Record<string, unknown>;
  if (typeof login.ready !== "boolean") return null;
  if (login.method != null && login.method !== "oidc" && login.method !== "clerk") return null;
  const reasonValue = login.reason;
  const reason =
    reasonValue === "auth_not_configured" ||
    reasonValue === "storage_unconfigured" ||
    reasonValue === "scopes_not_confirmed"
      ? reasonValue
      : null;
  if (reasonValue != null && reason == null) return null;
  const methodReady = login.method === "oidc" || login.method === "clerk";
  if (login.ready !== (methodReady && reason == null)) return null;
  return {
    status,
    authenticated: body.authenticated,
    expired: body.expired === true,
    user,
    csrfToken,
    login: {
      ready: login.ready,
      method: login.method === "oidc" || login.method === "clerk" ? login.method : null,
      reason,
    },
  };
}
