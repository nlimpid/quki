import { createAuthStore } from "@quki/db";
import { createAuthMemoryConn } from "../../../../packages/db/src/authMemory.js";
import { describe, expect, it } from "vitest";

import { createApp, type MarketSource } from "../app.js";
import { PRODUCTION_AUTH_ORIGINS, authCallbackUrl, type OidcClient } from "./oidc.js";
import type { AuthRuntime } from "./runtime.js";

function market(): MarketSource {
  return {
    mode: "fixture",
    async listInstruments() {
      return [];
    },
    async getDailyBars() {
      return [];
    },
    async countInstruments() {
      return 1;
    },
  };
}

function cookies(response: Response, name: string): string | undefined {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  return header?.split(";")[0]?.slice(name.length + 1);
}

describe("auth security regressions", () => {
  it("uses the exact issuer and sub, including case and a trailing slash", async () => {
    const store = createAuthStore(() => createAuthMemoryConn());
    const subject = "shared-sub";
    await store.insertUser({
      id: "user-a",
      issuer: "https://idp.example/realms/a",
      subject,
      displayName: "甲",
    });
    await store.insertUser({
      id: "user-b",
      issuer: "https://idp.example/realms/b",
      subject,
      displayName: "乙",
    });
    expect((await store.findUser("https://idp.example/realms/a", subject))?.id).toBe("user-a");
    expect((await store.findUser("https://idp.example/realms/b", subject))?.id).toBe("user-b");
    expect(await store.findUser("https://IDP.example/realms/a", subject)).toBeNull();
    expect(await store.findUser("https://idp.example/realms/a/", subject)).toBeNull();
    await expect(
      store.insertUser({
        id: "user-a2",
        issuer: "https://idp.example/realms/a",
        subject,
        displayName: "甲",
      }),
    ).rejects.toThrow(/duplicate identity/);
    expect((await store.findUser("https://idp.example/realms/a", subject))?.id).toBe("user-a");
  });

  it("refuses an untrusted host and ignores forwarded host headers", async () => {
    const seen: string[] = [];
    const oidc: OidcClient = {
      async authorizationUrl(input) {
        seen.push(input.redirectUri);
        const url = new URL("https://idp.example/authorize");
        url.searchParams.set("redirect_uri", input.redirectUri);
        url.searchParams.set("state", input.state);
        return url;
      },
      async complete() {
        return { issuer: "https://idp.example", subject: "person-a", displayName: null };
      },
    };
    const auth: AuthRuntime = {
      now: () => new Date("2026-11-16T00:00:00.000Z"),
      store: createAuthStore(() => createAuthMemoryConn()),
      holdings: null,
      oidc,
      unavailableReason: null,
      trustedOrigins: PRODUCTION_AUTH_ORIGINS,
    };
    const app = createApp(market(), auth);
    const session = await app.request("https://quki.cc/api/auth/session");
    const csrf = ((await session.json()) as { csrfToken: string }).csrfToken;
    const cookie = `qk_csrf=${cookies(session, "qk_csrf")}`;
    const forwarded = await app.request("https://quki.cc/api/auth/login", {
      method: "POST",
      headers: {
        origin: "https://quki.cc",
        "content-type": "application/json",
        cookie,
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "https",
        forwarded: "host=evil.example;proto=https",
      },
      body: JSON.stringify({ csrf, returnTo: "/portfolio" }),
    });
    expect(forwarded.status).toBe(302);
    expect(seen).toEqual(["https://quki.cc/api/auth/callback"]);
    expect(forwarded.headers.get("location")).not.toContain("evil.example");

    const fresh = await app.request("https://www.quki.cc/api/auth/session");
    const wwwCsrf = ((await fresh.json()) as { csrfToken: string }).csrfToken;
    const wwwLogin = await app.request("https://www.quki.cc/api/auth/login", {
      method: "POST",
      headers: {
        origin: "https://www.quki.cc",
        "content-type": "application/json",
        cookie: `qk_csrf=${cookies(fresh, "qk_csrf")}`,
      },
      body: JSON.stringify({ csrf: wwwCsrf, returnTo: "/" }),
    });
    expect(wwwLogin.status).toBe(302);
    expect(seen[1]).toBe("https://www.quki.cc/api/auth/callback");

    const hostile = await app.request("https://evil.example/api/auth/login", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
        cookie,
        "x-forwarded-host": "quki.cc",
      },
      body: JSON.stringify({ csrf, returnTo: "/" }),
    });
    expect(hostile.status).toBe(403);
    expect(hostile.headers.get("location")).toBeNull();
    expect(seen).not.toContain("https://evil.example/api/auth/callback");
    expect(
      authCallbackUrl(new URL("https://evil.example/api/auth/login"), PRODUCTION_AUTH_ORIGINS),
    ).toBeNull();
    expect(
      authCallbackUrl(
        new URL("https://quki.cc.evil.example/api/auth/login"),
        PRODUCTION_AUTH_ORIGINS,
      ),
    ).toBeNull();
  });

  it("lets one overlapping callback win and keeps a wrong state from consuming the transaction", async () => {
    let completions = 0;
    const issued = new Map<string, { verifier: string; nonce: string }>();
    const oidc: OidcClient = {
      async authorizationUrl(input) {
        issued.set(input.state, { verifier: input.codeVerifier, nonce: input.nonce });
        const url = new URL("https://idp.example/authorize");
        url.searchParams.set("state", input.state);
        return url;
      },
      async complete(input) {
        completions += 1;
        const saved = issued.get(input.expectedState);
        if (!saved || saved.verifier !== input.codeVerifier) throw new Error("binding");
        return { issuer: "https://idp.example", subject: "person-a", displayName: null };
      },
    };
    const auth: AuthRuntime = {
      now: () => new Date("2026-11-16T00:00:00.000Z"),
      store: createAuthStore(() => createAuthMemoryConn()),
      holdings: null,
      oidc,
      unavailableReason: null,
      trustedOrigins: ["https://quki.cc"],
    };
    const app = createApp(market(), auth);
    const session = await app.request("https://quki.cc/api/auth/session");
    const csrf = ((await session.json()) as { csrfToken: string }).csrfToken;
    const started = await app.request("https://quki.cc/api/auth/login", {
      method: "POST",
      headers: {
        origin: "https://quki.cc",
        "content-type": "application/json",
        cookie: `qk_csrf=${cookies(session, "qk_csrf")}`,
      },
      body: JSON.stringify({ csrf, returnTo: "/portfolio" }),
    });
    const oauth = cookies(started, "qk_oauth");
    const state = new URL(started.headers.get("location") ?? "").searchParams.get("state");
    const forged = await app.request("https://quki.cc/api/auth/callback?code=junk&state=forged", {
      headers: { cookie: `qk_oauth=${oauth}` },
    });
    expect(forged.headers.get("location")).toContain("error=login_failed");
    expect(completions).toBe(0);
    const callback = `https://quki.cc/api/auth/callback?code=from-idp&state=${state}`;
    const [first, second] = await Promise.all([
      app.request(callback, { headers: { cookie: `qk_oauth=${oauth}` } }),
      app.request(callback, { headers: { cookie: `qk_oauth=${oauth}` } }),
    ]);
    const winners = [first, second].filter((response) =>
      response.headers
        .getSetCookie()
        .some((value) => value.startsWith("qk_session=") && value.includes("Max-Age=1209600")),
    );
    expect(winners).toHaveLength(1);
    expect(completions).toBe(1);
    expect(
      [first, second].filter((response) =>
        response.headers.get("location")?.includes("login_failed"),
      ),
    ).toHaveLength(1);
  });

  it("revokes only the session cookie presented on a later login", async () => {
    const auth: AuthRuntime = {
      now: () => new Date("2026-11-16T00:00:00.000Z"),
      store: createAuthStore(() => createAuthMemoryConn()),
      holdings: null,
      oidc: {
        async authorizationUrl(input) {
          const url = new URL("https://idp.example/authorize");
          url.searchParams.set("state", input.state);
          return url;
        },
        async complete() {
          return { issuer: "https://idp.example", subject: "person-a", displayName: "林" };
        },
      },
      unavailableReason: null,
      trustedOrigins: ["https://quki.cc"],
    };
    const app = createApp(market(), auth);
    async function signIn(sessionCookie?: string) {
      const session = await app.request("https://quki.cc/api/auth/session");
      const csrf = ((await session.json()) as { csrfToken: string }).csrfToken;
      const started = await app.request("https://quki.cc/api/auth/login", {
        method: "POST",
        headers: {
          origin: "https://quki.cc",
          "content-type": "application/json",
          cookie: `qk_csrf=${cookies(session, "qk_csrf")}`,
        },
        body: JSON.stringify({ csrf, returnTo: "/" }),
      });
      const state = new URL(started.headers.get("location") ?? "").searchParams.get("state");
      const headers = new Headers();
      headers.set(
        "cookie",
        `qk_oauth=${cookies(started, "qk_oauth")}${sessionCookie ? `; qk_session=${sessionCookie}` : ""}`,
      );
      return app.request(`https://quki.cc/api/auth/callback?code=ok&state=${state}`, { headers });
    }
    const first = await signIn();
    const second = await signIn();
    const cookie1 = cookies(first, "qk_session") ?? "";
    const cookie2 = cookies(second, "qk_session") ?? "";
    const third = await signIn(cookie1);
    const cookie3 = cookies(third, "qk_session") ?? "";
    expect(
      (
        await app.request("https://quki.cc/api/account", {
          headers: { cookie: `qk_session=${cookie1}` },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request("https://quki.cc/api/account", {
          headers: { cookie: `qk_session=${cookie2}` },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request("https://quki.cc/api/account", {
          headers: { cookie: `qk_session=${cookie3}` },
        })
      ).status,
    ).toBe(200);
  });
});
