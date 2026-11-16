import * as oauth from "oauth4webapi";
import { describe, expect, it } from "vitest";

import { createApp, type MarketSource } from "../app.js";
import { createAuthMemoryConn } from "../../../../packages/db/src/authMemory.js";
import { createAuthStore, type SqlConn } from "@quki/db";
import { fetchSession } from "../../../../apps/web/src/lib/authClient.js";
import { applyProbeFailure, type AuthPhase } from "../../../../apps/web/src/lib/authState.js";
import {
  GOOGLE_ISSUER,
  GOOGLE_OIDC_SCOPES,
  acceptedGoogleIdTokenIssuer,
  authCallbackUrl,
  classifyOidcFailure,
  createOidcClient,
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

/** Generic metadata. It is not Google's discovery document. */
function genericDiscovery(issuer: string): Response {
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
    const https = await oauth.processDiscoveryResponse(expected, genericDiscovery(GOOGLE_ISSUER));
    expect(https.issuer).toBe(GOOGLE_ISSUER);
    expect(https.authorization_response_iss_parameter_supported).toBeUndefined();
    await expect(
      oauth.processDiscoveryResponse(expected, genericDiscovery("accounts.google.com")),
    ).rejects.toThrow(/Invalid URL|issuer/);
  });

  it("keeps production callbacks and refuses http extras", () => {
    expect(trustedAuthOrigins()).toEqual(["https://quki.cc", "https://www.quki.cc"]);
    expect(
      trustedAuthOrigins({
        AUTH_ALLOW_NONPRODUCTION_ORIGINS: "false",
        AUTH_NONPRODUCTION_HTTPS_ORIGINS: "https://login-test.example",
      }),
    ).toEqual(["https://quki.cc", "https://www.quki.cc"]);
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function b64url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Buffer.from(bytes).toString("base64url");
}

describe("Google discovery metadata on the real client", () => {
  it("requires callback iss before the token request and still checks nonce, audience, state, and PKCE", async () => {
    const keys = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
    const publicJwk = { ...jwk, kid: "test", alg: "RS256", use: "sig" };
    const parsed = readOidcEnv(google);
    if (!parsed.ok) throw new Error("google config");
    const client = createOidcClient(parsed.config);
    const tokenPosts: string[] = [];
    let tokenNonce = "nonce-1";
    let tokenAudience = "google-client";
    const previous = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes("/.well-known/openid-configuration")) {
        return jsonResponse({
          issuer: GOOGLE_ISSUER,
          authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
          token_endpoint: "https://token.test/token",
          jwks_uri: "https://jwks.test/certs",
          id_token_signing_alg_values_supported: ["RS256"],
          authorization_response_iss_parameter_supported: true,
        });
      }
      if (url === "https://jwks.test/certs") return jsonResponse({ keys: [publicJwk] });
      if (url === "https://token.test/token") {
        const text = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body ?? "");
        tokenPosts.push(text);
        const now = Math.floor(Date.now() / 1000);
        const header = b64url(JSON.stringify({ alg: "RS256", kid: "test" }));
        const payload = b64url(
          JSON.stringify({
            iss: GOOGLE_ISSUER,
            sub: "person-1",
            aud: tokenAudience,
            nonce: tokenNonce,
            iat: now,
            exp: now + 3600,
            name: "林",
          }),
        );
        const signed = new TextEncoder().encode(`${header}.${payload}`);
        const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, signed));
        return jsonResponse({
          access_token: "local-access",
          token_type: "Bearer",
          id_token: `${header}.${payload}.${b64url(signature)}`,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    };
    const callback = (iss?: string, state = "state-1") => {
      const url = new URL("https://quki.cc/api/auth/callback");
      url.searchParams.set("code", "auth-code");
      url.searchParams.set("state", state);
      if (iss !== undefined) url.searchParams.set("iss", iss);
      return url;
    };
    const call = (currentUrl: URL, nonce = "nonce-1", state = "state-1") =>
      client.complete({
        currentUrl,
        redirectUri: "https://quki.cc/api/auth/callback",
        expectedState: state,
        codeVerifier: "verifier-1",
        nonce,
      });
    try {
      tokenPosts.length = 0;
      await expect(call(callback())).rejects.toThrow(/iss/);
      expect(tokenPosts).toEqual([]);
      await expect(call(callback("accounts.google.com"))).rejects.toThrow(/iss/);
      expect(tokenPosts).toEqual([]);
      await expect(call(callback(GOOGLE_ISSUER), "nonce-1", "other-state")).rejects.toThrow(/state/);
      expect(tokenPosts).toEqual([]);
      const identity = await call(callback(GOOGLE_ISSUER));
      expect(identity).toMatchObject({ issuer: GOOGLE_ISSUER, subject: "person-1", displayName: "林" });
      expect(tokenPosts).toHaveLength(1);
      const posted = new URLSearchParams(tokenPosts[0]);
      expect(posted.get("code_verifier")).toBe("verifier-1");
      expect(posted.get("code")).toBe("auth-code");
      expect(posted.get("client_id")).toBe("google-client");
      expect(posted.get("grant_type")).toBe("authorization_code");
      await expect(call(callback(GOOGLE_ISSUER), "other-nonce")).rejects.toThrow(/nonce/);
      expect(tokenPosts).toHaveLength(2);
      tokenAudience = "other-client";
      await expect(call(callback(GOOGLE_ISSUER))).rejects.toThrow(/aud|audience/);
      expect(tokenPosts).toHaveLength(3);
    } finally {
      globalThis.fetch = previous;
    }
  });
});

describe("login.ready does not prove the database", () => {
  it("stays ready for an anonymous read, then fails the write and a cookie lookup", async () => {
    let calls = 0;
    const conn: SqlConn = {
      async execute() {
        calls += 1;
        throw new Error("tables_missing");
      },
    };
    const auth: AuthRuntime = {
      now: () => new Date("2026-11-16T00:00:00.000Z"),
      store: createAuthStore(() => conn),
      oidc: {
        async authorizationUrl() {
          return new URL("https://accounts.google.com/o/oauth2/v2/auth");
        },
        async complete() {
          throw new Error("unused");
        },
      },
      unavailableReason: null,
      trustedOrigins: ["https://quki.cc"],
    };
    const app = createApp(market(), auth);
    const anonymous = await app.request("https://quki.cc/api/auth/session");
    expect(calls).toBe(0);
    expect(anonymous.status).toBe(200);
    const body = (await anonymous.json()) as { login: { ready: boolean }; status: string };
    expect(body.status).toBe("anonymous");
    expect(body.login.ready).toBe(true);
    const csrf = anonymous.headers.getSetCookie().find((cookie) => cookie.startsWith("qk_csrf="));
    const token = csrf?.split(";")[0]?.split("=")[1] ?? "";
    const post = await app.request("https://quki.cc/api/auth/login", {
      method: "POST",
      headers: {
        origin: "https://quki.cc",
        "content-type": "application/json",
        cookie: `qk_csrf=${token}`,
      },
      body: JSON.stringify({ csrf: token, returnTo: "/portfolio" }),
    });
    expect(post.status).toBe(503);
    expect(post.headers.get("location")).toBeNull();
    expect(calls).toBeGreaterThan(0);
    const lookup = await app.request("https://quki.cc/api/auth/session", {
      headers: { cookie: "qk_session=present" },
    });
    expect(lookup.status).toBe(503);
    await expect(fetchSession(async () => lookup)).rejects.toThrow(/session_unavailable/);
    const initializing: AuthPhase = { kind: "initializing", login: { state: "unknown" } };
    expect(applyProbeFailure(initializing)).toMatchObject({ kind: "unknown" });
  });
});
