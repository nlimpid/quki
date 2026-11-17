import {
  AUTH_OAUTH_MAX_AGE_SECONDS,
  AUTH_SESSION_MAX_AGE_SECONDS,
  publicDisplayName,
  safeReturnTo,
  type AuthSessionResponse,
} from "@quki/types";
import type { Context } from "hono";
import type { Hono } from "hono";

import {
  clearAuthCookie,
  CSRF_COOKIE,
  OAUTH_COOKIE,
  readCookie,
  SESSION_COOKIE,
  writeCsrfCookie,
  writeOauthCookie,
  writeSessionCookie,
} from "./cookies.js";
import { randomToken, secretsEqual, sha256Hex } from "./crypto.js";
import { bearerFromAuthorization, verifyClerkSessionToken } from "./clerkVerify.js";
import type { OidcIdentity } from "./oidc.js";
import { authCallbackUrl, classifyOidcFailure } from "./oidc.js";
import type { AuthRuntime } from "./runtime.js";
import { IdentityTableMissing } from "@quki/db";

function noStore(c: Context): void {
  c.header("cache-control", "no-store");
}

function sameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.origin !== new URL(request.url).origin) return false;
  const site = request.headers.get("sec-fetch-site");
  return site !== "cross-site";
}

async function readFields(c: Context): Promise<Record<string, unknown>> {
  const type = c.req.header("content-type") ?? "";
  if (type.includes("application/json")) {
    const value = await c.req.json<unknown>().catch(() => null);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  }
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await c.req.parseBody();
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(form)) {
      if (typeof value === "string") fields[key] = value;
    }
    return fields;
  }
  return {};
}

function csrfField(c: Context, fields: Record<string, unknown>): string {
  const header = c.req.header("x-csrf-token");
  const body = typeof fields.csrf === "string" ? fields.csrf : "";
  if (header && body && header !== body) return "";
  return header || body;
}

function sessionPayload(
  response: Omit<AuthSessionResponse, "login"> & {
    ready: boolean;
    method?: AuthSessionResponse["login"]["method"];
    reason: AuthSessionResponse["login"]["reason"];
  },
): AuthSessionResponse {
  return {
    status: response.status,
    authenticated: response.authenticated,
    expired: response.expired,
    user: response.user,
    csrfToken: response.csrfToken,
    login: {
      ready: response.ready,
      method: response.ready ? (response.method ?? "oidc") : null,
      reason: response.ready ? null : response.reason,
    },
  };
}

function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function validIssuer(issuer: string): boolean {
  if (!issuer.startsWith("https://") || hasControlChar(issuer)) return false;
  const size = new TextEncoder().encode(issuer).byteLength;
  return size <= 512;
}

function validSubject(subject: string): boolean {
  if (subject.length === 0 || hasControlChar(subject)) return false;
  return new TextEncoder().encode(subject).byteLength <= 512;
}

async function upsertUser(auth: AuthRuntime, identity: OidcIdentity) {
  const store = auth.store;
  if (!store) throw new Error("auth_storage_failed");
  if (!validIssuer(identity.issuer)) throw new Error("issuer");
  const displayName = publicDisplayName(identity.displayName);
  const existing = await store.findUser(identity.issuer, identity.subject);
  if (existing) {
    if (displayName && displayName !== existing.displayName) {
      await store.updateDisplayName(existing.id, displayName);
      return { id: existing.id, displayName };
    }
    return existing;
  }
  const created = { id: crypto.randomUUID(), displayName };
  try {
    await store.insertUser({
      id: created.id,
      issuer: identity.issuer,
      subject: identity.subject,
      displayName,
    });
  } catch (error) {
    const raced = await store.findUser(identity.issuer, identity.subject);
    if (!raced) throw error;
    return raced;
  }
  return created;
}

export function mountAuthRoutes(app: Hono, auth: AuthRuntime): void {
  app.get("/api/auth/session", async (c) => {
    noStore(c);
    const bearer = bearerFromAuthorization(c.req.header("authorization"));
    if (c.req.header("authorization")) {
      if (!bearer) return c.json({ error: "unauthorized", message: "需要登录" }, 401);
      if (!auth.clerk) {
        return c.json(
          sessionPayload({
            status: "unavailable",
            authenticated: false,
            expired: false,
            user: null,
            csrfToken: null,
            ready: false,
            reason: "auth_not_configured",
          }),
          503,
        );
      }
      const verified = await verifyClerkSessionToken(bearer, auth.clerk);
      if (!verified.ok) return c.json({ error: "unauthorized", message: "需要登录" }, 401);
      if (!auth.identities) {
        return c.json(
          sessionPayload({
            status: "unavailable",
            authenticated: false,
            expired: false,
            user: null,
            csrfToken: null,
            ready: false,
            reason: "storage_unconfigured",
          }),
          503,
        );
      }
      try {
        const id = await auth.identities.resolve(verified.issuer, verified.subject, auth.now());
        return c.json(
          sessionPayload({
            status: "authenticated",
            authenticated: true,
            expired: false,
            user: { id, displayName: null },
            csrfToken: randomToken(),
            ready: true,
            method: "clerk",
            reason: null,
          }),
        );
      } catch (error) {
        const reason =
          error instanceof IdentityTableMissing ? "storage_unconfigured" : "auth_not_configured";
        return c.json(
          sessionPayload({
            status: "unavailable",
            authenticated: false,
            expired: false,
            user: null,
            csrfToken: null,
            ready: false,
            reason,
          }),
          503,
        );
      }
    }
    const ready = auth.store != null && auth.oidc != null && auth.unavailableReason == null;
    if (!auth.store) {
      return c.json(
        sessionPayload({
          status: "unavailable",
          authenticated: false,
          expired: false,
          user: null,
          csrfToken: null,
          ready: false,
          reason: auth.unavailableReason ?? "auth_not_configured",
        }),
      );
    }
    const token = readCookie(c, SESSION_COOKIE);
    if (!token) {
      const csrfToken = randomToken();
      writeCsrfCookie(c, csrfToken);
      return c.json(
        sessionPayload({
          status: "anonymous",
          authenticated: false,
          expired: false,
          user: null,
          csrfToken,
          ready,
          reason: auth.unavailableReason,
        }),
      );
    }
    try {
      const lookup = await auth.store.findSession(await sha256Hex(token), auth.now());
      if (lookup.state !== "valid") {
        clearAuthCookie(c, SESSION_COOKIE);
        return c.json(
          sessionPayload({
            status: "anonymous",
            authenticated: false,
            expired: true,
            user: null,
            csrfToken: null,
            ready,
            reason: auth.unavailableReason,
          }),
        );
      }
      return c.json(
        sessionPayload({
          status: "authenticated",
          authenticated: true,
          expired: false,
          user: { id: lookup.user.id, displayName: publicDisplayName(lookup.user.displayName) },
          csrfToken: lookup.csrfToken,
          ready,
          reason: null,
        }),
      );
    } catch {
      console.error("auth_session_lookup_failed");
      return c.json({ error: "auth_unavailable", message: "登录暂不可用" }, 503);
    }
  });

  app.post("/api/auth/login", async (c) => {
    noStore(c);
    if (!auth.store || !auth.oidc || auth.unavailableReason) {
      return c.json({ error: "auth_unavailable", message: "登录尚未配置" }, 503);
    }
    if (!sameOriginMutation(c.req.raw)) {
      return c.json({ error: "csrf", message: "请求未通过安全校验" }, 403);
    }
    const fields = await readFields(c);
    const csrf = csrfField(c, fields);
    const cookie = readCookie(c, CSRF_COOKIE) ?? "";
    if (!cookie || !csrf || !(await secretsEqual(cookie, csrf))) {
      return c.json({ error: "csrf", message: "请求未通过安全校验" }, 403);
    }
    const requestUrl = new URL(c.req.url);
    const redirectUri = authCallbackUrl(requestUrl, auth.trustedOrigins);
    if (!redirectUri)
      return c.json({ error: "untrusted_origin", message: "请求未通过安全校验" }, 403);
    const returnTo = safeReturnTo(fields.returnTo, requestUrl.origin);
    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken();
    const txnToken = randomToken();
    let authorizationUrl: URL;
    try {
      authorizationUrl = await auth.oidc.authorizationUrl({
        redirectUri,
        state,
        nonce,
        codeVerifier,
      });
      if (authorizationUrl.protocol !== "https:")
        throw new Error("insecure_authorization_endpoint");
      await auth.store.insertTransaction({
        id: crypto.randomUUID(),
        tokenHash: await sha256Hex(txnToken),
        state,
        codeVerifier,
        nonce,
        returnTo,
        expiresAt: new Date(auth.now().getTime() + AUTH_OAUTH_MAX_AGE_SECONDS * 1000),
      });
    } catch (error) {
      console.error("auth_login_start_failed");
      if (classifyOidcFailure(error) === "provider_unreachable") {
        return c.json({ error: "provider_unreachable", message: "暂时联系不上 Google" }, 503);
      }
      return c.json({ error: "auth_unavailable", message: "登录暂不可用" }, 503);
    }
    writeOauthCookie(c, txnToken);
    return c.redirect(authorizationUrl.toString(), 302);
  });

  app.get("/api/auth/callback", async (c) => {
    noStore(c);
    const requestUrl = new URL(c.req.url);
    const fail = (returnTo = "/", code = "login_failed") => {
      clearAuthCookie(c, OAUTH_COOKIE);
      const params = new URLSearchParams({ error: code, returnTo });
      return c.redirect(`/login?${params.toString()}`, 302);
    };
    const redirectUri = authCallbackUrl(requestUrl, auth.trustedOrigins);
    if (!redirectUri)
      return c.json({ error: "untrusted_origin", message: "请求未通过安全校验" }, 400);
    if (!auth.store || !auth.oidc || auth.unavailableReason) return fail();
    const txnToken = readCookie(c, OAUTH_COOKIE);
    if (!txnToken) return fail();
    let returnTo = "/";
    try {
      const claim = await auth.store.claimTransaction(
        await sha256Hex(txnToken),
        requestUrl.searchParams.get("state") ?? "",
        auth.now(),
      );
      if (claim.outcome === "mismatch")
        return fail(safeReturnTo(claim.returnTo, requestUrl.origin));
      if (claim.outcome !== "claimed") return fail();
      const txn = claim.record;
      returnTo = safeReturnTo(txn.returnTo, requestUrl.origin);
      const currentUrl = new URL(c.req.url);
      currentUrl.searchParams.delete("returnTo");
      const identity = await auth.oidc.complete({
        currentUrl,
        redirectUri,
        expectedState: txn.state,
        codeVerifier: txn.codeVerifier,
        nonce: txn.nonce,
      });
      if (!validSubject(identity.subject) || !validIssuer(identity.issuer)) return fail(returnTo);
      const user = await upsertUser(auth, identity);
      const presented = readCookie(c, SESSION_COOKIE);
      if (presented) {
        const current = await auth.store.findSession(await sha256Hex(presented), auth.now());
        if (current.state === "valid")
          await auth.store.revokeSession(current.sessionId, auth.now());
      }
      const sessionToken = randomToken();
      const csrfToken = randomToken();
      await auth.store.insertSession({
        id: crypto.randomUUID(),
        userId: user.id,
        tokenHash: await sha256Hex(sessionToken),
        csrfToken,
        expiresAt: new Date(auth.now().getTime() + AUTH_SESSION_MAX_AGE_SECONDS * 1000),
      });
      clearAuthCookie(c, OAUTH_COOKIE);
      writeSessionCookie(c, sessionToken);
      return c.redirect(returnTo, 302);
    } catch (error) {
      console.error("auth_callback_failed");
      return fail(returnTo, classifyOidcFailure(error));
    }
  });

  app.post("/api/auth/logout", async (c) => {
    noStore(c);
    if (!sameOriginMutation(c.req.raw)) {
      return c.json({ error: "csrf", message: "请求未通过安全校验" }, 403);
    }
    const token = readCookie(c, SESSION_COOKIE);
    if (!token) {
      clearAuthCookie(c, SESSION_COOKIE);
      return c.body(null, 204);
    }
    if (!auth.store) return c.json({ error: "auth_unavailable", message: "登录暂不可用" }, 503);
    try {
      const lookup = await auth.store.findSession(await sha256Hex(token), auth.now());
      if (lookup.state !== "valid") {
        clearAuthCookie(c, SESSION_COOKIE);
        return c.body(null, 204);
      }
      const fields = await readFields(c);
      const csrf = csrfField(c, fields);
      if (!csrf || !(await secretsEqual(csrf, lookup.csrfToken))) {
        return c.json({ error: "csrf", message: "请求未通过安全校验" }, 403);
      }
      await auth.store.revokeSession(lookup.sessionId, auth.now());
      clearAuthCookie(c, SESSION_COOKIE);
      return c.body(null, 204);
    } catch {
      console.error("auth_logout_failed");
      return c.json({ error: "auth_unavailable", message: "登录暂不可用" }, 503);
    }
  });

  app.get("/api/account", async (c) => {
    const user = await requireUser(c, auth);
    if (user instanceof Response) return user;
    noStore(c);
    return c.json({ user: { id: user.id, displayName: user.displayName } });
  });

  app.get("/api/users/:userId", async (c) => {
    const user = await requireUser(c, auth);
    if (user instanceof Response) return user;
    noStore(c);
    if (c.req.param("userId") !== user.id) {
      return c.json({ error: "forbidden", message: "无权访问该账户" }, 403);
    }
    return c.json({ user: { id: user.id, displayName: user.displayName } });
  });
}

async function requireUser(
  c: Context,
  auth: AuthRuntime,
): Promise<{ id: string; displayName: string | null } | Response> {
  noStore(c);
  const token = readCookie(c, SESSION_COOKIE);
  if (!token || !auth.store) return c.json({ error: "unauthorized", message: "需要登录" }, 401);
  try {
    const lookup = await auth.store.findSession(await sha256Hex(token), auth.now());
    if (lookup.state !== "valid")
      return c.json({ error: "unauthorized", message: "需要登录" }, 401);
    return { id: lookup.user.id, displayName: publicDisplayName(lookup.user.displayName) };
  } catch {
    console.error("auth_account_lookup_failed");
    return c.json({ error: "auth_unavailable", message: "登录暂不可用" }, 503);
  }
}
