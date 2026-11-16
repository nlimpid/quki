import { publicDisplayName } from "@quki/types";
import * as oauth from "oauth4webapi";

export type OidcConfig = {
  issuer: URL;
  clientId: string;
  clientSecret: string;
  scopes: "openid";
};

export type OidcIdentity = {
  subject: string;
  displayName: string | null;
};

export type OidcClient = {
  authorizationUrl(input: {
    redirectUri: string;
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<URL>;
  complete(input: {
    currentUrl: URL;
    redirectUri: string;
    expectedState: string;
    codeVerifier: string;
    nonce: string;
  }): Promise<OidcIdentity>;
};

export type OidcEnv = {
  AUTH_OIDC_ISSUER?: string;
  AUTH_OIDC_CLIENT_ID?: string;
  AUTH_OIDC_CLIENT_SECRET?: string;
  AUTH_OIDC_SCOPES?: string;
};

export function callbackUri(requestUrl: URL): string {
  return new URL("/api/auth/callback", requestUrl.origin).toString();
}

export function readOidcEnv(
  env: OidcEnv,
):
  | { ok: true; config: OidcConfig }
  | { ok: false; reason: "auth_not_configured" | "scopes_not_confirmed" } {
  const issuerText = env.AUTH_OIDC_ISSUER?.trim() ?? "";
  const clientId = env.AUTH_OIDC_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.AUTH_OIDC_CLIENT_SECRET?.trim() ?? "";
  if (!issuerText || !clientId || !clientSecret)
    return { ok: false, reason: "auth_not_configured" };
  let issuer: URL;
  try {
    issuer = new URL(issuerText);
  } catch {
    return { ok: false, reason: "auth_not_configured" };
  }
  if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.hash) {
    return { ok: false, reason: "auth_not_configured" };
  }
  const scopes = (env.AUTH_OIDC_SCOPES ?? "openid").trim();
  if (scopes !== "openid") return { ok: false, reason: "scopes_not_confirmed" };
  return { ok: true, config: { issuer, clientId, clientSecret, scopes: "openid" } };
}

export async function buildAuthorizationUrl(
  as: oauth.AuthorizationServer,
  config: Pick<OidcConfig, "clientId" | "scopes">,
  input: { redirectUri: string; state: string; nonce: string; codeVerifier: string },
): Promise<URL> {
  if (!as.authorization_endpoint) throw new Error("missing_authorization_endpoint");
  const endpoint = new URL(as.authorization_endpoint);
  if (endpoint.protocol !== "https:") throw new Error("insecure_authorization_endpoint");
  const challenge = await oauth.calculatePKCECodeChallenge(input.codeVerifier);
  endpoint.searchParams.set("client_id", config.clientId);
  endpoint.searchParams.set("redirect_uri", input.redirectUri);
  endpoint.searchParams.set("response_type", "code");
  endpoint.searchParams.set("scope", config.scopes);
  endpoint.searchParams.set("code_challenge", challenge);
  endpoint.searchParams.set("code_challenge_method", "S256");
  endpoint.searchParams.set("state", input.state);
  endpoint.searchParams.set("nonce", input.nonce);
  return endpoint;
}

async function discover(issuer: URL): Promise<oauth.AuthorizationServer> {
  const response = await oauth.discoveryRequest(issuer);
  return oauth.processDiscoveryResponse(issuer, response);
}

export function createOidcClient(config: OidcConfig): OidcClient {
  const client: oauth.Client = { client_id: config.clientId };
  const clientAuthentication = oauth.ClientSecretPost(config.clientSecret);
  return {
    async authorizationUrl(input) {
      return buildAuthorizationUrl(await discover(config.issuer), config, input);
    },
    async complete(input) {
      const as = await discover(config.issuer);
      const params = oauth.validateAuthResponse(as, client, input.currentUrl, input.expectedState);
      const response = await oauth.authorizationCodeGrantRequest(
        as,
        client,
        clientAuthentication,
        params,
        input.redirectUri,
        input.codeVerifier,
      );
      const result = await oauth.processAuthorizationCodeResponse(as, client, response, {
        expectedNonce: input.nonce,
        requireIdToken: true,
      });
      const claims = oauth.getValidatedIdTokenClaims(result);
      if (!claims?.sub) throw new Error("missing_sub");
      const claimName = claims.name ?? claims.preferred_username;
      return { subject: claims.sub, displayName: publicDisplayName(claimName) };
    },
  };
}
