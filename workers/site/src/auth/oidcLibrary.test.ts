import * as oauth from "oauth4webapi";
import { describe, expect, it } from "vitest";

import {
  GOOGLE_ISSUER,
  PRODUCTION_AUTH_ORIGINS,
  acceptedGoogleIdTokenIssuer,
  authCallbackUrl,
  buildAuthorizationUrl,
  classifyOidcFailure,
  isGoogleIssuerUrl,
  readOidcEnv,
  trustedAuthOrigins,
} from "./oidc.js";

const as: oauth.AuthorizationServer = {
  issuer: "https://idp.example",
  authorization_endpoint: "https://idp.example/authorize",
  token_endpoint: "https://idp.example/oauth/token",
};

describe("oauth4webapi", () => {
  it("rejects a callback whose state does not match and builds a PKCE challenge", async () => {
    const client = { client_id: "quki-web" };
    const url = new URL("https://quki.cc/api/auth/callback?code=abc&state=expected");
    expect(oauth.validateAuthResponse(as, client, url, "expected").get("code")).toBe("abc");
    expect(() => oauth.validateAuthResponse(as, client, url, "other")).toThrow(/state/);

    const verifier = oauth.generateRandomCodeVerifier();
    const challenge = await oauth.calculatePKCECodeChallenge(verifier);
    expect(challenge).not.toBe(verifier);
    const authorization = await buildAuthorizationUrl(
      as,
      { clientId: "quki-web", scopes: "openid profile" },
      {
        redirectUri:
          authCallbackUrl(new URL("https://quki.cc/index/H30269"), PRODUCTION_AUTH_ORIGINS) ?? "",
        state: "state-1",
        nonce: "nonce-1",
        codeVerifier: verifier,
      },
    );
    expect(authorization.origin).toBe("https://idp.example");
    expect(authorization.searchParams.get("code_challenge")).toBe(challenge);
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("code_verifier")).toBeNull();
    expect(authorization.searchParams.get("client_secret")).toBeNull();
    expect(authorization.searchParams.get("scope")).toBe("openid profile");
    expect(authorization.searchParams.get("redirect_uri")).toBe(
      "https://quki.cc/api/auth/callback",
    );
  });

  it("refuses an http authorization endpoint", async () => {
    await expect(
      buildAuthorizationUrl(
        { ...as, authorization_endpoint: "http://idp.example/authorize" },
        { clientId: "quki-web", scopes: "openid profile" },
        {
          redirectUri: "https://quki.cc/api/auth/callback",
          state: "state-1",
          nonce: "nonce-1",
          codeVerifier: oauth.generateRandomCodeVerifier(),
        },
      ),
    ).rejects.toThrow(/insecure/);
  });
});

describe("Google issuer", () => {
  it("accepts only the accounts.google.com issuer and openid profile", () => {
    expect(isGoogleIssuerUrl(new URL(GOOGLE_ISSUER))).toBe(true);
    expect(isGoogleIssuerUrl(new URL("https://accounts.google.com/o/oauth2/v2/auth"))).toBe(false);
    expect(isGoogleIssuerUrl(new URL("https://idp.example"))).toBe(false);
    expect(acceptedGoogleIdTokenIssuer(GOOGLE_ISSUER)).toBe(true);
    expect(acceptedGoogleIdTokenIssuer("https://accounts.google.com/")).toBe(false);
    expect(acceptedGoogleIdTokenIssuer("accounts.google.com")).toBe(false);
    expect(
      readOidcEnv({
        AUTH_OIDC_ISSUER: GOOGLE_ISSUER,
        AUTH_OIDC_CLIENT_ID: "client",
        AUTH_OIDC_CLIENT_SECRET: "labelled-fixture-not-a-real-secret",
      }).ok,
    ).toBe(true);
    expect(
      readOidcEnv({
        AUTH_OIDC_ISSUER: "https://idp.example",
        AUTH_OIDC_CLIENT_ID: "client",
        AUTH_OIDC_CLIENT_SECRET: "labelled-fixture-not-a-real-secret",
        AUTH_OIDC_SCOPES: "openid profile",
      }).ok,
    ).toBe(false);
    expect(classifyOidcFailure(new TypeError("failed to fetch"))).toBe("provider_unreachable");
    const rejected = new Error("access_denied");
    rejected.name = "AuthorizationResponseError";
    expect(classifyOidcFailure(rejected)).toBe("provider_rejected");
    expect(classifyOidcFailure(new Error("issuer"))).toBe("login_failed");
    expect(trustedAuthOrigins({})).toEqual([...PRODUCTION_AUTH_ORIGINS]);
    expect(
      trustedAuthOrigins({
        AUTH_ALLOW_NONPRODUCTION_ORIGINS: "true",
        AUTH_NONPRODUCTION_HTTPS_ORIGINS: "http://127.0.0.1:8787,https://preview.example",
      }),
    ).toEqual([...PRODUCTION_AUTH_ORIGINS, "https://preview.example"]);
  });
});
