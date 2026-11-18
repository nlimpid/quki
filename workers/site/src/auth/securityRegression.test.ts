import { createAuthStore } from "@quki/db";
import { createAuthMemoryConn } from "../../../../packages/db/src/authMemory.js";
import { describe, expect, it } from "vitest";

import { createApp, type MarketSource } from "../app.js";
import { PRODUCTION_AUTH_ORIGINS, authCallbackUrl } from "./oidc.js";
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

  it("does not start OIDC or accept a session cookie", async () => {
    const auth: AuthRuntime = {
      now: () => new Date("2026-11-16T00:00:00.000Z"),
      store: createAuthStore(() => createAuthMemoryConn()),
      holdings: null,
      clerk: null,
      identities: null,
      oidc: {
        async authorizationUrl() {
          throw new Error("oidc must not run");
        },
        async complete() {
          throw new Error("oidc must not run");
        },
      },
      unavailableReason: null,
      trustedOrigins: PRODUCTION_AUTH_ORIGINS,
    };
    const app = createApp(market(), auth);
    const login = await app.request("https://quki.cc/api/auth/login", {
      method: "POST",
      headers: {
        origin: "https://quki.cc",
        "content-type": "application/json",
        cookie: "qk_csrf=present",
        "x-forwarded-host": "evil.example",
        forwarded: "host=evil.example;proto=https",
      },
      body: JSON.stringify({ csrf: "present", returnTo: "/portfolio" }),
    });
    expect(login.status).toBe(404);
    expect(login.headers.get("location")).toBeNull();
    expect(login.headers.getSetCookie()).toEqual([]);
    const hostile = await app.request("https://evil.example/api/auth/login", {
      method: "POST",
      headers: { origin: "https://evil.example", cookie: "qk_session=present" },
    });
    expect(hostile.status).toBe(404);
    expect(hostile.headers.get("location")).toBeNull();
    const account = await app.request("https://quki.cc/api/account", {
      headers: { cookie: "qk_session=present" },
    });
    expect(account.status).toBe(401);
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
});
