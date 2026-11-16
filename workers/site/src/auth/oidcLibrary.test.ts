import * as oauth from "oauth4webapi";
import { describe, expect, it } from "vitest";

import { buildAuthorizationUrl, callbackUri } from "./oidc.js";

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
      { clientId: "quki-web", scopes: "openid" },
      {
        redirectUri: callbackUri(new URL("https://quki.cc/index/H30269")),
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
    expect(authorization.searchParams.get("scope")).toBe("openid");
    expect(authorization.searchParams.get("redirect_uri")).toBe(
      "https://quki.cc/api/auth/callback",
    );
  });

  it("refuses an http authorization endpoint", async () => {
    await expect(
      buildAuthorizationUrl(
        { ...as, authorization_endpoint: "http://idp.example/authorize" },
        { clientId: "quki-web", scopes: "openid" },
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
