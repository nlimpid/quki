import * as oauth from "oauth4webapi";
import { describe, expect, it } from "vitest";

import { createApp, type MarketSource } from "../app.js";
import { createAuthMemoryConn } from "../../../../packages/db/src/authMemory.js";
import { createAuthStore } from "@quki/db";
import {
  GOOGLE_ISSUER,
  GOOGLE_OIDC_SCOPES,
  acceptedGoogleIdTokenIssuer,
  authCallbackUrl,
  classifyOidcFailure,
  readOidcEnv,
  trustedAuthOrigins,
  type OidcClient,
} from "./oidc.js";
import type { AuthRuntime } from "./runtime.js";

const google = {
  AUTH_OIDC_ISSUER: GOOGLE_ISSUER,
  AUTH_OIDC_CLIENT_ID: "google-client",
  AUTH_OIDC_CLIENT_SECRET: "google-secret",
};

function discovery(issuer: string): Response {
  return new Response(
    JSON.stringify({
      issuer,
      authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      token_endpoint: "https://oauth2.googleapis.com/token",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("Google issuer and scopes", () => {
  it("accepts only the https discovery issuer and the openid profile set", () => {
    expect(readOidcEnv(google)).toMatchObject({
      ok: true,
      config: { scopes: GOOGLE_OIDC_SCOPES },
    });
    expect(
      readOidcEnv({ ...google, AUTH_OIDC_SCOPES: "profile openid" }),
    ).toMatchObject({ ok: true, config: { scopes: "openid profile" } });
    expect(readOidcEnv({ ...google, AUTH_OIDC_SCOPES: "openid" })).toMatchObject({
      ok: false,
      reason: "scopes_not_confirmed",
    });
    expect(readOidcEnv({ ...google, AUTH_OIDC_SCOPES: "openid profile email" })).toMatchObject({
      ok: false,
      reason: "scopes_not_confirmed",
    });
    expect(acceptedGoogleIdTokenIssuer(GOOGLE_ISSUER)).toBe(true);
    expect(acceptedGoogleIdTokenIssuer("accounts.google.com")).toBe(false);
    expect(acceptedGoogleIdTokenIssuer("https://accounts.google.com/")).toBe(false);
    expect(readOidcEnv({ ...google, AUTH_OIDC_ISSUER: "accounts.google.com" })).toEqual({
      ok: false,
      reason: "auth_not_configured",
    });
  });

  it("lets oauth4webapi reject a scheme-less discovery issuer", async () => {
    const expected = new URL(GOOGLE_ISSUER);
    const https = await oauth.processDiscoveryResponse(expected, discovery(GOOGLE_ISSUER));
    expect(https.issuer).toBe(GOOGLE_ISSUER);
    await expect(
      oauth.processDiscoveryResponse(expected, discovery("accounts.google.com")),
    ).rejects.toThrow(/Invalid URL|issuer/);
  });

  it("keeps production callbacks and refuses http extras", () => {
    expect(trustedAuthOrigins()).toEqual(["https://quki.cc", "https://www.quki.cc"]);
    expect(
      trustedAuthOrigins({
        AUTH_NONPRODUCTION_HTTPS_ORIGINS: "https://login-test.example",
      }),
    ).toEqual(["https://quki.cc", "https://www.quki.cc"]);
    expect(
      trustedAuthOrigins({
        AUTH_ALLOW_NONPRODUCTION_ORIGINS: "true",
        AUTH_NONPRODUCTION_HTTPS_ORIGINS:
          "https://login-test.example, http://localhost:5173, https://quki.cc",
      }),
    ).toEqual(["https://quki.cc", "https://www.quki.cc", "https://login-test.example"]);
    expect(authCallbackUrl(new URL("http://localhost:5173/login"), trustedAuthOrigins())).toBeNull();
    expect(authCallbackUrl(new URL("https://quki.cc/login"), trustedAuthOrigins())).toBe(
      "https://quki.cc/api/auth/callback",
    );
    expect(authCallbackUrl(new URL("https://www.quki.cc/login"), trustedAuthOrigins())).toBe(
      "https://www.quki.cc/api/auth/callback",
    );
  });
});

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
      return 0;
    },
  };
}

function appWith(oidc: OidcClient) {
  const auth: AuthRuntime = {
    now: () => new Date("2026-11-16T00:00:00.000Z"),
    store: createAuthStore(() => createAuthMemoryConn()),
    oidc,
    unavailableReason: null,
    trustedOrigins: ["https://quki.cc", "https://www.quki.cc"],
  };
  return createApp(market(), auth);
}

async function start(app: ReturnType<typeof createApp>) {
  const session = await app.request("https://quki.cc/api/auth/session");
  const body = (await session.json()) as { csrfToken: string };
  const csrf = body.csrfToken;
  const started = await app.request("https://quki.cc/api/auth/login", {
    method: "POST",
    headers: {
      origin: "https://quki.cc",
      "content-type": "application/x-www-form-urlencoded",
      cookie: `qk_csrf=${csrf}`,
    },
    body: new URLSearchParams({ csrf, returnTo: "/portfolio" }),
  });
  return {
    started,
    oauthCookie: started.headers.getSetCookie().find((cookie) => cookie.startsWith("qk_oauth=")),
  };
}

describe("mock Google login is not a live Google pass", () => {
  it("names a Google refusal and a network failure without creating a session", async () => {
    const refused = appWith({
      async authorizationUrl(input) {
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.searchParams.set("state", input.state);
        return url;
      },
      async complete() {
        const error = new Error("authorization response from the server is an error");
        error.name = "AuthorizationResponseError";
        throw error;
      },
    });
    const started = await start(refused);
    expect(started.started.status).toBe(302);
    expect(started.started.headers.get("location")).toContain("accounts.google.com");
    expect(started.started.headers.get("location")).not.toContain("google-secret");
    const oauthCookie = started.oauthCookie?.split(";")[0]?.split("=")[1] ?? "";
    const state = new URL(started.started.headers.get("location") ?? "").searchParams.get("state");
    const callback = await refused.request(
      `https://quki.cc/api/auth/callback?error=access_denied&state=${state}`,
      { headers: { cookie: `qk_oauth=${oauthCookie}` } },
    );
    expect(callback.status).toBe(302);
    const failed = new URL(callback.headers.get("location") ?? "", "https://quki.cc");
    expect(failed.pathname).toBe("/login");
    expect(failed.searchParams.get("error")).toBe("provider_rejected");
    expect(callback.headers.getSetCookie().join(";")).not.toContain("qk_session=");

    const offline = appWith({
      async authorizationUrl() {
        throw new TypeError("fetch failed");
      },
      async complete() {
        throw new Error("unused");
      },
    });
    const down = await start(offline);
    expect(down.started.status).toBe(503);
    expect(await down.started.json()).toEqual({
      error: "provider_unreachable",
      message: "暂时联系不上 Google",
    });
    expect(down.started.headers.get("location")).toBeNull();
    expect(classifyOidcFailure(new TypeError("fetch failed"))).toBe("provider_unreachable");
  });

  it("does not store a scheme-less issuer", async () => {
    const app = appWith({
      async authorizationUrl(input) {
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.searchParams.set("state", input.state);
        return url;
      },
      async complete() {
        return { issuer: "accounts.google.com", subject: "person", displayName: "林" };
      },
    });
    const started = await start(app);
    const oauthCookie = started.oauthCookie?.split(";")[0]?.split("=")[1] ?? "";
    const state = new URL(started.started.headers.get("location") ?? "").searchParams.get("state");
    const callback = await app.request(
      `https://quki.cc/api/auth/callback?code=abc&state=${state}`,
      { headers: { cookie: `qk_oauth=${oauthCookie}` } },
    );
    expect(callback.status).toBe(302);
    expect(new URL(callback.headers.get("location") ?? "", "https://quki.cc").searchParams.get("error")).toBe(
      "login_failed",
    );
    const session = await app.request("https://quki.cc/api/auth/session");
    expect(await session.json()).toMatchObject({ authenticated: false, user: null });
  });
});
