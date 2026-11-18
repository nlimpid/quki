import { IdentityTableMissing } from "@quki/db";
import type { AuthSessionResponse } from "@quki/types";
import type { Context } from "hono";
import type { Hono } from "hono";

import { bearerFromAuthorization, verifyClerkSessionToken } from "./clerkVerify.js";
import { clearAuthCookie, CSRF_COOKIE, OAUTH_COOKIE, SESSION_COOKIE } from "./cookies.js";
import { randomToken } from "./crypto.js";
import { clerkLoginReady, type AuthRuntime } from "./runtime.js";

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
      method: response.ready ? (response.method ?? "clerk") : null,
      reason: response.ready ? null : response.reason,
    },
  };
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
    const ready = clerkLoginReady(auth);
    return c.json(
      sessionPayload({
        status: ready ? "anonymous" : "unavailable",
        authenticated: false,
        expired: false,
        user: null,
        csrfToken: null,
        ready,
        method: ready ? "clerk" : null,
        reason: ready ? null : auth.clerk ? "storage_unconfigured" : "auth_not_configured",
      }),
    );
  });

  app.post("/api/auth/login", (c) => {
    noStore(c);
    return c.json({ error: "not_found", message: "登录入口已关闭" }, 404);
  });

  app.get("/api/auth/callback", (c) => {
    noStore(c);
    return c.json({ error: "not_found", message: "登录入口已关闭" }, 404);
  });

  app.post("/api/auth/logout", async (c) => {
    noStore(c);
    if (!sameOriginMutation(c.req.raw)) {
      return c.json({ error: "csrf", message: "请求未通过安全校验" }, 403);
    }
    const user = await requireUser(c, auth);
    if (user instanceof Response) return user;
    clearAuthCookie(c, SESSION_COOKIE);
    clearAuthCookie(c, OAUTH_COOKIE);
    clearAuthCookie(c, CSRF_COOKIE);
    return c.body(null, 204);
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
  const bearer = bearerFromAuthorization(c.req.header("authorization"));
  if (!bearer) return c.json({ error: "unauthorized", message: "需要登录" }, 401);
  if (!auth.clerk || !auth.identities) {
    return c.json({ error: "auth_unavailable", message: "登录暂不可用" }, 503);
  }
  const verified = await verifyClerkSessionToken(bearer, auth.clerk);
  if (!verified.ok) return c.json({ error: "unauthorized", message: "需要登录" }, 401);
  try {
    const id = await auth.identities.resolve(verified.issuer, verified.subject, auth.now());
    return { id, displayName: null };
  } catch (error) {
    if (error instanceof IdentityTableMissing) {
      return c.json({ error: "auth_unavailable", message: "登录暂不可用" }, 503);
    }
    console.error("auth_account_lookup_failed");
    return c.json({ error: "auth_unavailable", message: "登录暂不可用" }, 503);
  }
}
