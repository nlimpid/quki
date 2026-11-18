import { createAuthStore, createHoldingStore, createIdentityStore } from "@quki/db";
import { createIdentityMemoryConn } from "../../../../packages/db/src/identityMemory.js";
import { createCandidateHoldingMemoryConn } from "../../../../packages/db/src/holdingMemory.js";
import { createAuthMemoryConn } from "../../../../packages/db/src/authMemory.js";
import { PHASE1_INSTRUMENTS } from "@quki/types";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createApp, type MarketSource } from "../app.js";
import { clearClerkJwksCache } from "./clerkVerify.js";
import { fixtureKey, signSessionToken } from "./clerkTestToken.js";
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

const oidcLeftover = {
  AUTH_OIDC_ISSUER: "https://accounts.google.com",
  AUTH_OIDC_CLIENT_ID: "quki-web",
  AUTH_OIDC_CLIENT_SECRET: "secret-value",
  AUTH_OIDC_SCOPES: "openid profile",
};

function noConnect(): never {
  throw new Error("should not connect");
}

describe("auth routes", () => {
  it("keeps anonymous market data public", async () => {
    const app = createApp(market(), authRuntimeFromEnv({}, noConnect));
    const health = await app.request(`${origin}/api/health`);
    expect(health.status).toBe(200);
    const instruments = await app.request(`${origin}/api/instruments`);
    expect(instruments.status).toBe(200);
  });

  it("sets guest ready from Clerk and the identity store, ignoring leftover OIDC", async () => {
    let connects = 0;
    const ready = authRuntimeFromEnv(
      {
        ...oidcLeftover,
        CLERK_JWT_ISSUER: "https://trusted.example",
        TIDB_QUKI_DATABASE_URL: "mysql://labelled-not-connected",
      },
      () => {
        connects += 1;
        return noConnect();
      },
    );
    expect(ready.clerk?.issuer).toBe("https://trusted.example");
    expect(ready.identities).not.toBeNull();
    expect(ready.oidc).toBeNull();
    expect(ready.store).toBeNull();
    expect(ready.unavailableReason).toBeNull();
    expect(JSON.stringify(ready)).not.toContain("secret-value");
    const session = await createApp(market(), ready).request(`${origin}/api/auth/session`);
    expect(session.status).toBe(200);
    expect(session.headers.get("cache-control")).toContain("no-store");
    expect(session.headers.get("set-cookie")).toBeNull();
    expect(await session.json()).toEqual({
      status: "anonymous",
      authenticated: false,
      expired: false,
      user: null,
      csrfToken: null,
      login: { ready: true, method: "clerk", reason: null },
    });
    expect(connects).toBe(0);

    const missingIssuer = authRuntimeFromEnv(
      { ...oidcLeftover, TIDB_QUKI_DATABASE_URL: "mysql://labelled-not-connected" },
      noConnect,
    );
    expect(missingIssuer.clerk).toBeNull();
    expect(missingIssuer.identities).not.toBeNull();
    const missingIssuerBody = await (
      await createApp(market(), missingIssuer).request(`${origin}/api/auth/session`)
    ).json();
    expect(missingIssuerBody).toMatchObject({
      authenticated: false,
      login: { ready: false, method: null, reason: "auth_not_configured" },
    });

    const invalidIssuer = authRuntimeFromEnv(
      {
        ...oidcLeftover,
        CLERK_JWT_ISSUER: "http://trusted.example",
        TIDB_QUKI_DATABASE_URL: "mysql://labelled-not-connected",
      },
      noConnect,
    );
    expect(invalidIssuer.clerk).toBeNull();
    const invalidBody = await (
      await createApp(market(), invalidIssuer).request(`${origin}/api/auth/session`)
    ).json();
    expect(invalidBody).toMatchObject({
      authenticated: false,
      login: { ready: false, method: null, reason: "auth_not_configured" },
    });

    const missingStore = authRuntimeFromEnv(
      { ...oidcLeftover, CLERK_JWT_ISSUER: "https://trusted.example" },
      noConnect,
    );
    expect(missingStore.clerk).not.toBeNull();
    expect(missingStore.identities).toBeNull();
    expect(missingStore.unavailableReason).toBe("storage_unconfigured");
    const missingStoreBody = await (
      await createApp(market(), missingStore).request(`${origin}/api/auth/session`)
    ).json();
    expect(missingStoreBody).toMatchObject({
      authenticated: false,
      login: { ready: false, method: null, reason: "storage_unconfigured" },
    });
  });

  it("does not authenticate through OIDC login, callback, or a session cookie", async () => {
    const auth: AuthRuntime = {
      now: () => new Date("2026-11-16T00:00:00.000Z"),
      store: createAuthStore(() => createAuthMemoryConn()),
      holdings: null,
      clerk: { issuer: "https://trusted.example", authorizedParties: ["https://quki.cc"] },
      identities: createIdentityStore(() => createIdentityMemoryConn()),
      oidc: {
        async authorizationUrl() {
          throw new Error("oidc must not run");
        },
        async complete() {
          throw new Error("oidc must not run");
        },
      },
      unavailableReason: null,
      trustedOrigins: testOrigins,
    };
    const app = createApp(market(), auth);
    const login = await app.request(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ csrf: "x", returnTo: "https://evil.example" }),
    });
    expect(login.status).toBe(404);
    expect(await login.json()).toEqual({ error: "not_found", message: "登录入口已关闭" });
    expect(login.headers.get("location")).toBeNull();
    expect(login.headers.getSetCookie()).toEqual([]);

    const callback = await app.request(
      `${origin}/api/auth/callback?code=from-idp&state=abc&sub=person-a`,
      { headers: { cookie: "qk_oauth=present" } },
    );
    expect(callback.status).toBe(404);
    expect(callback.headers.get("location")).toBeNull();
    expect(callback.headers.getSetCookie()).toEqual([]);

    const account = await app.request(`${origin}/api/account`, {
      headers: { cookie: "qk_session=present; __session=present" },
    });
    expect(account.status).toBe(401);
    const logout = await app.request(`${origin}/api/auth/logout`, {
      method: "POST",
      headers: { origin, cookie: "qk_session=present; __session=present" },
    });
    expect(logout.status).toBe(401);
    expect(logout.headers.getSetCookie()).toEqual([]);
  });

  it("authorizes account and logout with the Clerk bearer", async () => {
    clearClerkJwksCache();
    const key = fixtureKey();
    const identities = createIdentityMemoryConn();
    const app = createApp(market(), {
      now: () => new Date("2026-11-16T00:00:00.000Z"),
      store: createAuthStore(() => createAuthMemoryConn()),
      holdings: null,
      clerk: {
        issuer: "https://trusted.example",
        authorizedParties: ["https://quki.cc"],
        fetchJwks: async () => new Response(JSON.stringify(key.jwks), { status: 200 }),
      },
      identities: createIdentityStore(() => identities),
      oidc: null,
      unavailableReason: null,
      trustedOrigins: testOrigins,
    });
    const token = signSessionToken(key.privateKey, {
      iss: "https://trusted.example",
      sub: "user_fixture_subject",
      azp: "https://quki.cc",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    });
    const headers = { authorization: `Bearer ${token}`, origin };
    const account = await app.request(`${origin}/api/account`, { headers });
    expect(account.status).toBe(200);
    const body = (await account.json()) as { user: { id: string; displayName: string | null } };
    expect(body.user.id).not.toBe("user_fixture_subject");
    expect(body.user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.user.displayName).toBeNull();
    const other = await app.request(`${origin}/api/users/someone-else`, { headers });
    expect(other.status).toBe(403);
    const mine = await app.request(`${origin}/api/users/${body.user.id}`, { headers });
    expect(mine.status).toBe(200);
    const loggedOut = await app.request(`${origin}/api/auth/logout`, {
      method: "POST",
      headers: { ...headers, cookie: "qk_session=ignored" },
    });
    expect(loggedOut.status).toBe(204);
  });

  it("does not store holdings while the account book is absent", async () => {
    const anon = await createApp(market(), {
      now: () => new Date("2026-11-16T00:00:00.000Z"),
      store: null,
      holdings: null,
      clerk: null,
      identities: null,
      oidc: null,
      unavailableReason: "auth_not_configured",
      trustedOrigins: testOrigins,
    }).request(`${origin}/api/holdings`, {
      method: "PUT",
      headers: { origin },
    });
    expect(anon.status).toBe(401);
    clearClerkJwksCache();
    const key = fixtureKey();
    const identities = createIdentityMemoryConn();
    const clerkApp = createApp(market(), {
      now: () => new Date("2026-11-16T00:00:00.000Z"),
      store: null,
      holdings: null,
      clerk: {
        issuer: "https://trusted.example",
        authorizedParties: ["https://quki.cc"],
        fetchJwks: async () => new Response(JSON.stringify(key.jwks), { status: 200 }),
      },
      identities: createIdentityStore(() => identities),
      oidc: null,
      unavailableReason: null,
      trustedOrigins: testOrigins,
    });
    const token = signSessionToken(key.privateKey, {
      iss: "https://trusted.example",
      sub: "user_fixture_subject",
      azp: "https://quki.cc",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    });
    const headers = {
      origin,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    const cookieOnly = await clerkApp.request(`${origin}/api/holdings`, {
      method: "PUT",
      headers: { origin, cookie: "qk_session=not-a-bearer" },
      body: JSON.stringify({ code: "000001", shares: 100, expectedVersion: null }),
    });
    expect(cookieOnly.status).toBe(401);
    const denied = await clerkApp.request(`${origin}/api/holdings`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ code: "000001", shares: 100, expectedVersion: null }),
    });
    expect(denied.status).toBe(503);
    expect(await denied.json()).toEqual({
      error: "holdings_unavailable",
      message: "账户持仓尚未开通，没有写入任何持仓。",
    });
    const replaced = await clerkApp.request(`${origin}/api/holdings`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ items: [{ code: "000001", shares: 100 }] }),
    });
    expect(replaced.status).toBe(400);
    const missingVersion = await clerkApp.request(`${origin}/api/holdings/000001`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ expectedVersion: null }),
    });
    expect(missingVersion.status).toBe(400);
    const account = await clerkApp.request(`${origin}/api/holdings`, {
      headers: { authorization: headers.authorization },
    });
    expect(account.status).toBe(503);
    expect(await account.json()).toEqual({
      error: "holdings_unavailable",
      message: "账户持仓尚未开通，没有写入任何持仓。",
    });
  });

  it("does not call the local holdings writer from add, edit, or delete", () => {
    const portfolio = readFileSync(
      new URL("../../../../apps/web/src/pages/PortfolioPage.tsx", import.meta.url),
      "utf8",
    );
    const stock = readFileSync(
      new URL("../../../../apps/web/src/pages/StockPage.tsx", import.meta.url),
      "utf8",
    );
    expect(portfolio).not.toContain("saveHolding");
    expect(portfolio).not.toContain("deleteHolding");
    expect(portfolio).not.toContain("writeHoldings");
    expect(stock).not.toContain("saveHolding");
    expect(stock).not.toContain("writeHoldings");
    expect(portfolio).toContain("useAccountBook");
    expect(portfolio).toContain("removeRow");
    expect(portfolio).not.toContain("AccountBookPanel");
    expect(portfolio).toContain("此浏览器里的旧持仓");
    const panel = readFileSync(
      new URL("../../../../apps/web/src/lib/AccountBookPanel.tsx", import.meta.url),
      "utf8",
    );
    expect(panel).toContain("expectedVersion: item.version");
    expect(panel).toContain("removeRow");
    expect(panel).not.toContain("writeHoldings");
    expect(panel).not.toContain("holdingsStore");
  });

  it("uses a labelled fixture session and an in-process fake database, not Google or TiDB", async () => {
    const memory = createCandidateHoldingMemoryConn(["600519"]);
    const versions = [
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "cccccccccccccccccccccccccccccccc",
    ];
    let index = 0;
    clearClerkJwksCache();
    const key = fixtureKey();
    const identities = createIdentityMemoryConn();
    const app = createApp(market(), {
      now: () => new Date("2026-11-16T00:00:00.000Z"),
      store: null,
      holdings: createHoldingStore(() => memory, {
        newVersion: () => versions[index++] ?? "dddddddddddddddddddddddddddddddd",
      }),
      clerk: {
        issuer: "https://trusted.example",
        authorizedParties: ["https://quki.cc"],
        fetchJwks: async () => new Response(JSON.stringify(key.jwks), { status: 200 }),
      },
      identities: createIdentityStore(() => identities),
      oidc: null,
      unavailableReason: null,
      trustedOrigins: testOrigins,
    });
    const token = signSessionToken(key.privateKey, {
      iss: "https://trusted.example",
      sub: "user_fixture_not_google",
      azp: "https://quki.cc",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    });
    const headers = {
      origin,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
    const created = await app.request(`${origin}/api/holdings`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        code: "600519",
        shares: 100,
        expectedVersion: null,
        userId: "other-ignored",
      }),
    });
    expect(created.status).toBe(200);
    const row = (await created.json()) as { version: string; shares: number };
    expect(row.version).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const unknown = await app.request(`${origin}/api/holdings`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ code: "000001", shares: 100, expectedVersion: null }),
    });
    expect(unknown.status).toBe(404);
    const stale = await app.request(`${origin}/api/holdings/600519`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ expectedVersion: row.version }),
    });
    expect(stale.status).toBe(204);
    const again = await app.request(`${origin}/api/holdings`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ code: "600519", shares: 40, expectedVersion: null }),
    });
    expect(again.status).toBe(200);
    const resurrect = await app.request(`${origin}/api/holdings`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ code: "600519", shares: 9, expectedVersion: row.version }),
    });
    expect(resurrect.status).toBe(409);
    const mine = await app.request(`${origin}/api/holdings`, {
      headers: { authorization: headers.authorization },
    });
    expect(await mine.json()).toEqual({
      items: [
        {
          code: "600519",
          shares: 40,
          version: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          updatedAt: "2026-11-16 00:00:00.000",
        },
      ],
    });
  });
});
