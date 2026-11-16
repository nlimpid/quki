import { createAuthStore, type AuthStore } from "@quki/db";
import { createAuthMemoryConn } from "../../../../packages/db/src/authMemory.js";
import { PHASE1_INSTRUMENTS } from "@quki/types";
import { describe, expect, it } from "vitest";

import { createApp, type MarketSource } from "../app.js";
import type { OidcClient } from "./oidc.js";
import { readOidcEnv } from "./oidc.js";
import { authRuntimeFromEnv, type AuthRuntime } from "./runtime.js";

const origin = "http://quki.test";
const testOrigins = [
  "http://quki.test",
  "http://127.0.0.1:8787",
  "https://quki.cc",
  "https://www.quki.cc",
];

function market(): MarketSource {
  return {
    mode: "fixture",
    async listInstruments() {
      return [PHASE1_INSTRUMENTS[0]!];
    },
    async getDailyBars() {
      return [];
    },
    async countInstruments() {
      return 1;
    },
  };
}

function fakeOidc(): OidcClient {
  const issued = new Map<string, { verifier: string; nonce: string }>();
  return {
    async authorizationUrl(input) {
      issued.set(input.state, { verifier: input.codeVerifier, nonce: input.nonce });
      const url = new URL("https://idp.example/authorize");
      url.searchParams.set("state", input.state);
      url.searchParams.set("redirect_uri", input.redirectUri);
      return url;
    },
    async complete(input) {
      const saved = issued.get(input.expectedState);
      const state = input.currentUrl.searchParams.get("state");
      if (
        !saved ||
        saved.verifier !== input.codeVerifier ||
        saved.nonce !== input.nonce ||
        state !== input.expectedState
      ) {
        throw new Error("oauth_binding");
      }
      issued.delete(input.expectedState);
      return {
        issuer: input.currentUrl.searchParams.get("iss") ?? "https://idp.example",
        subject: input.currentUrl.searchParams.get("sub") ?? "",
        displayName: input.currentUrl.searchParams.get("name"),
      };
    },
  };
}

function runtime(now = new Date("2026-11-16T00:00:00.000Z")) {
  const memory = createAuthMemoryConn();
  let clock = now;
  const auth: AuthRuntime = {
    now: () => clock,
    store: createAuthStore(() => memory),
    oidc: fakeOidc(),
    unavailableReason: null,
    trustedOrigins: testOrigins,
  };
  return {
    app: createApp(market(), auth),
    memory,
    setNow(date: Date) {
      clock = date;
    },
  };
}

function cookiesOf(response: Response): { name: string; value: string; header: string }[] {
  return response.headers.getSetCookie().map((header) => {
    const pair = header.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    return { name: pair.slice(0, eq), value: pair.slice(eq + 1), header };
  });
}

function cookieValue(response: Response, name: string): string {
  const found = cookiesOf(response).find((cookie) => cookie.name === name);
  expect(found?.name).toBe(name);
  return found?.value ?? "";
}

function assertGuardedCookie(header: string, maxAge: number): void {
  expect(header).toContain("HttpOnly");
  expect(header).toContain("Secure");
  expect(header).toContain("SameSite=Lax");
  expect(header).toContain("Path=/");
  expect(header).toContain(`Max-Age=${maxAge}`);
  expect(header.toLowerCase()).not.toContain("domain=");
}

async function login(
  app: ReturnType<typeof createApp>,
  input: {
    sub: string;
    name?: string | null;
    returnTo?: string;
    host?: string;
    callback?: boolean;
  },
) {
  const host = input.host ?? origin;
  const session = await app.request(`${host}/api/auth/session`);
  const csrfBody = (await session.json()) as { csrfToken: string };
  const csrf = cookieValue(session, "qk_csrf");
  expect(csrf).toBe(csrfBody.csrfToken);
  const started = await app.request(`${host}/api/auth/login`, {
    method: "POST",
    headers: {
      origin: host,
      "content-type": "application/json",
      cookie: `qk_csrf=${csrf}`,
    },
    body: JSON.stringify({
      csrf,
      returnTo: input.returnTo ?? "/portfolio?edit=1",
      userId: "attacker",
    }),
  });
  const location = new URL(started.headers.get("location") ?? "");
  const oauth = cookieValue(started, "qk_oauth");
  const name = input.name == null ? "" : `&name=${encodeURIComponent(input.name)}`;
  if (input.callback === false) {
    return {
      session,
      started,
      callback: null,
      oauth,
      csrf,
      state: location.searchParams.get("state") ?? "",
    };
  }
  const callback = await app.request(
    `${host}/api/auth/callback?code=from-idp&state=${location.searchParams.get("state")}&sub=${encodeURIComponent(input.sub)}${name}`,
    { headers: { cookie: `qk_oauth=${oauth}` } },
  );
  return {
    session,
    started,
    callback,
    oauth,
    csrf,
    state: location.searchParams.get("state") ?? "",
  };
}

describe("auth routes", () => {
  it("keeps anonymous market data public and refuses login when auth is not configured", async () => {
    const app = createApp(market());
    const health = await app.request(`${origin}/api/health`);
    const instruments = await app.request(`${origin}/api/instruments`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, instruments: 1 });
    expect(instruments.status).toBe(200);
    expect(await instruments.json()).toEqual({ instruments: [PHASE1_INSTRUMENTS[0]] });
    const session = await app.request(`${origin}/api/auth/session`);
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      status: "unavailable",
      authenticated: false,
      expired: false,
      user: null,
      csrfToken: null,
      login: { ready: false, method: null, reason: "auth_not_configured" },
    });
    expect(cookiesOf(session).some((cookie) => cookie.name === "qk_session")).toBe(false);
    const loginResponse = await app.request(`${origin}/api/auth/login`, { method: "POST" });
    expect(loginResponse.status).toBe(503);
    expect(await loginResponse.json()).toEqual({
      error: "auth_unavailable",
      message: "登录尚未配置",
    });
    expect(loginResponse.headers.get("location")).toBeNull();
    const account = await app.request(`${origin}/api/account`);
    expect(account.status).toBe(401);
    expect(await account.json()).toEqual({ error: "unauthorized", message: "需要登录" });
  });

  it("sets guarded cookies, rejects cross-site login, and blocks open redirects", async () => {
    const { app, memory } = runtime();
    const badOrigin = await app.request(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ csrf: "x", returnTo: "/" }),
    });
    expect(badOrigin.status).toBe(403);
    expect(badOrigin.headers.get("location")).toBeNull();

    const { started, callback } = await login(app, {
      sub: "person-a",
      name: "林",
      returnTo: "https://evil.example/phish",
    });
    expect(started.status).toBe(302);
    const idp = new URL(started.headers.get("location") ?? "");
    expect(idp.origin).toBe("https://idp.example");
    expect(idp.pathname).toBe("/authorize");
    expect(idp.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/callback`);
    expect(idp.searchParams.has("code_verifier")).toBe(false);
    assertGuardedCookie(
      cookiesOf(started).find((cookie) => cookie.name === "qk_oauth")?.header ?? "",
      600,
    );
    if (!callback) throw new Error("missing callback");
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("/");
    const sessionCookie = cookiesOf(callback).find((cookie) => cookie.name === "qk_session");
    assertGuardedCookie(sessionCookie?.header ?? "", 1_209_600);
    expect(callback.headers.get("location")).not.toContain("evil.example");

    const jar = `qk_session=${sessionCookie?.value}`;
    const account = await app.request(`${origin}/api/account?userId=attacker`, {
      headers: { cookie: jar },
    });
    const body = (await account.json()) as { user: { id: string; displayName: string | null } };
    expect(account.status).toBe(200);
    expect(body.user.displayName).toBe("林");
    expect(body.user.id).not.toBe("attacker");
    expect(JSON.stringify(body)).not.toContain(sessionCookie?.value ?? "missing-token");
    const subjectBytes = new TextEncoder().encode("person-a");
    expect(memory.queries.every((query) => !query.sql.includes("person-a"))).toBe(true);
    expect(
      memory.queries.some((query) =>
        query.params.some(
          (param) =>
            param instanceof Uint8Array &&
            param.byteLength === subjectBytes.byteLength &&
            param.every((byte, index) => byte === subjectBytes[index]),
        ),
      ),
    ).toBe(true);

    const loopback = await login(runtime().app, {
      sub: "local-user",
      host: "http://127.0.0.1:8787",
    });
    if (!loopback.callback) throw new Error("missing callback");
    expect(
      cookiesOf(loopback.callback).find((cookie) => cookie.name === "qk_session")?.header,
    ).toContain("Secure");
  });

  it("isolates users and distinguishes 401 from 403", async () => {
    const { app } = runtime();
    const first = await login(app, { sub: "person-a", name: "林" });
    const second = await login(app, { sub: "person-b", name: "ada@example.com" });
    if (!first.callback || !second.callback) throw new Error("missing callback");
    const cookieA = `qk_session=${cookieValue(first.callback, "qk_session")}`;
    const cookieB = `qk_session=${cookieValue(second.callback, "qk_session")}`;
    const accountA = (await (
      await app.request(`${origin}/api/account`, { headers: { cookie: cookieA } })
    ).json()) as {
      user: { id: string; displayName: string | null };
    };
    const accountB = (await (
      await app.request(`${origin}/api/account`, { headers: { cookie: cookieB } })
    ).json()) as {
      user: { id: string; displayName: string | null };
    };
    expect(accountA.user.displayName).toBe("林");
    expect(accountB.user.displayName).toBeNull();
    expect(accountA.user.id).not.toBe(accountB.user.id);

    const anonymous = await app.request(`${origin}/api/users/${accountA.user.id}`);
    expect(anonymous.status).toBe(401);
    const forbidden = await app.request(`${origin}/api/users/${accountB.user.id}`, {
      headers: { cookie: cookieA },
    });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "forbidden", message: "无权访问该账户" });
    const allowed = await app.request(
      `${origin}/api/users/${accountA.user.id}?userId=${accountB.user.id}`,
      {
        headers: { cookie: cookieA },
      },
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ user: accountA.user });

    const health = await app.request(`${origin}/api/health`, { headers: { cookie: cookieA } });
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, storage: "fixture" });
  });

  it("requires CSRF on logout, revokes the session, and reports expiry", async () => {
    const { app, setNow } = runtime();
    const { callback } = await login(app, { sub: "person-a", name: "林" });
    if (!callback) throw new Error("missing callback");
    const sessionCookie = cookieValue(callback, "qk_session");
    const jar = `qk_session=${sessionCookie}`;
    const me = await app.request(`${origin}/api/auth/session`, { headers: { cookie: jar } });
    const csrf = ((await me.json()) as { csrfToken: string }).csrfToken;

    const crossSite = await app.request(`${origin}/api/auth/logout`, {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json", cookie: jar },
      body: JSON.stringify({ csrf }),
    });
    expect(crossSite.status).toBe(403);
    expect((await app.request(`${origin}/api/account`, { headers: { cookie: jar } })).status).toBe(
      200,
    );

    const wrong = await app.request(`${origin}/api/auth/logout`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", cookie: jar },
      body: JSON.stringify({ csrf: "not-the-token" }),
    });
    expect(wrong.status).toBe(403);
    expect((await app.request(`${origin}/api/account`, { headers: { cookie: jar } })).status).toBe(
      200,
    );

    const missing = await app.request(`${origin}/api/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar },
      body: JSON.stringify({ csrf }),
    });
    expect(missing.status).toBe(403);

    const loggedOut = await app.request(`${origin}/api/auth/logout`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", cookie: jar },
      body: JSON.stringify({ csrf }),
    });
    expect(loggedOut.status).toBe(204);
    expect(cookiesOf(loggedOut).find((cookie) => cookie.name === "qk_session")?.header).toContain(
      "Max-Age=0",
    );
    expect((await app.request(`${origin}/api/account`, { headers: { cookie: jar } })).status).toBe(
      401,
    );
    const again = await app.request(`${origin}/api/auth/logout`, {
      method: "POST",
      headers: { origin, cookie: jar },
    });
    expect(again.status).toBe(204);

    const expiredLogin = await login(app, { sub: "person-a", name: "林" });
    if (!expiredLogin.callback) throw new Error("missing callback");
    const expiredCookie = cookieValue(expiredLogin.callback, "qk_session");
    setNow(new Date("2026-12-02T00:00:00.000Z"));
    const expired = await app.request(`${origin}/api/auth/session`, {
      headers: { cookie: `qk_session=${expiredCookie}` },
    });
    expect(expired.status).toBe(200);
    expect(await expired.json()).toMatchObject({
      status: "anonymous",
      authenticated: false,
      expired: true,
      user: null,
    });
    expect(
      (
        await app.request(`${origin}/api/account`, {
          headers: { cookie: `qk_session=${expiredCookie}` },
        })
      ).status,
    ).toBe(401);
  });

  it("rejects a reused callback, a mismatched state, and a storage failure without leaking the driver error", async () => {
    const { app } = runtime();
    const started = await login(app, { sub: "person-a", returnTo: "/portfolio?edit=1" });
    expect(started.callback?.headers.get("location")).toBe("/portfolio?edit=1");
    const replay = await app.request(
      `${origin}/api/auth/callback?code=from-idp&state=${started.state}&sub=person-a`,
      {
        headers: { cookie: `qk_oauth=${started.oauth}` },
      },
    );
    expect(replay.status).toBe(302);
    expect(replay.headers.get("location")).toContain("/login?error=login_failed");
    expect(
      cookiesOf(replay).some(
        (cookie) => cookie.name === "qk_session" && cookie.header.includes("Max-Age=1209600"),
      ),
    ).toBe(false);

    const mismatch = runtime();
    const open = await login(mismatch.app, {
      sub: "person-a",
      returnTo: "/stocks",
      callback: false,
    });
    expect(open.started.status).toBe(302);
    const badState = await mismatch.app.request(
      `${origin}/api/auth/callback?code=from-idp&state=forged&sub=person-a&returnTo=https://evil.example`,
      { headers: { cookie: `qk_oauth=${open.oauth}` } },
    );
    expect(badState.status).toBe(302);
    expect(badState.headers.get("location")).toContain("error=login_failed");
    expect(badState.headers.get("location")).toContain("returnTo=%2Fstocks");
    expect(badState.headers.get("location")).not.toContain("evil");
    expect(cookiesOf(badState).some((cookie) => cookie.name === "qk_session")).toBe(false);
    const real = await mismatch.app.request(
      `${origin}/api/auth/callback?code=from-idp&state=${open.state}&sub=person-a`,
      { headers: { cookie: `qk_oauth=${open.oauth}` } },
    );
    expect(real.status).toBe(302);
    expect(real.headers.get("location")).toBe("/stocks");
    expect(cookiesOf(real).some((cookie) => cookie.name === "qk_session")).toBe(true);

    const throwing: AuthStore = {
      async findUser() {
        throw new Error("mysql://user:password@gateway.example:4000/quki");
      },
      async insertUser() {
        throw new Error("mysql://user:password@gateway.example:4000/quki");
      },
      async updateDisplayName() {
        throw new Error("down");
      },
      async insertSession() {
        throw new Error("down");
      },
      async findSession() {
        throw new Error("mysql://user:password@gateway.example:4000/quki");
      },
      async revokeSession() {
        throw new Error("down");
      },
      async insertTransaction() {
        throw new Error("down");
      },
      async claimTransaction() {
        throw new Error("down");
      },
    };
    const broken = createApp(market(), {
      now: () => new Date(),
      store: throwing,
      oidc: fakeOidc(),
      unavailableReason: null,
      trustedOrigins: testOrigins,
    });
    const failed = await broken.request(`${origin}/api/auth/session`, {
      headers: { cookie: "qk_session=present" },
    });
    expect(failed.status).toBe(503);
    const text = await failed.text();
    expect(text).not.toContain("password");
    expect(text).not.toContain("mysql://");
    expect(
      (await broken.request(`${origin}/api/account`, { headers: { cookie: "qk_session=present" } }))
        .status,
    ).toBe(503);
  });

  it("does not connect until an auth query runs, and rejects an unconfirmed scope", () => {
    let connections = 0;
    const idle = authRuntimeFromEnv(
      {
        TIDB_QUKI_DATABASE_URL: "mysql://user:secret-value@gateway.example:4000/quki",
        AUTH_OIDC_ISSUER: "https://idp.example/realms/quki",
        AUTH_OIDC_CLIENT_ID: "quki-web",
        AUTH_OIDC_CLIENT_SECRET: "secret-value",
      },
      () => {
        connections += 1;
        return createAuthMemoryConn();
      },
      () => fakeOidc(),
    );
    expect(connections).toBe(0);
    expect(idle.unavailableReason).toBeNull();
    expect(idle.store).not.toBeNull();

    const missingDatabase = authRuntimeFromEnv(
      {
        AUTH_OIDC_ISSUER: "https://idp.example",
        AUTH_OIDC_CLIENT_ID: "quki-web",
        AUTH_OIDC_CLIENT_SECRET: "secret-value",
      },
      () => {
        throw new Error("should not connect");
      },
    );
    expect(missingDatabase.store).toBeNull();
    expect(missingDatabase.unavailableReason).toBe("storage_unconfigured");
    expect(JSON.stringify(missingDatabase)).not.toContain("secret-value");

    expect(readOidcEnv({ AUTH_OIDC_SCOPES: "openid email" }).ok).toBe(false);
    expect(
      readOidcEnv({
        AUTH_OIDC_ISSUER: "http://idp.example",
        AUTH_OIDC_CLIENT_ID: "a",
        AUTH_OIDC_CLIENT_SECRET: "b",
      }),
    ).toEqual({
      ok: false,
      reason: "auth_not_configured",
    });
    expect(
      readOidcEnv({
        AUTH_OIDC_ISSUER: "https://user:password@idp.example",
        AUTH_OIDC_CLIENT_ID: "a",
        AUTH_OIDC_CLIENT_SECRET: "b",
      }),
    ).toEqual({ ok: false, reason: "auth_not_configured" });
  });
});
