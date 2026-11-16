import { publicDisplayName } from "@quki/types";
import * as oauth from "oauth4webapi";

/**
 * Discovery document fetched 2026-11-16 from
 * https://accounts.google.com/.well-known/openid-configuration
 * Its `issuer` string is exactly this value. oauth4webapi 3.8.8 compares an ID
 * token `iss` to that string with `!==`, and compares the callback `iss`
 * parameter the same way. `new URL("accounts.google.com")` is not a valid
 * absolute URL, so a scheme-less discovery issuer fails inside
 * `processDiscoveryResponse` before any account is stored. This code does not
 * rewrite `accounts.google.com` into the https issuer.
 */
export const GOOGLE_ISSUER = "https://accounts.google.com";
/** Sent to Google. `profile` may include `name`; `email` is not requested. */
export const GOOGLE_OIDC_SCOPES = "openid profile" as const;

export type OidcConfig = {
  issuer: URL;
  clientId: string;
  clientSecret: string;
  scopes: typeof GOOGLE_OIDC_SCOPES;
};

export type OidcIdentity = {
  /** Exact `iss` claim. Not lowercased and not rewritten with URL.href. */
  issuer: string;
  subject: string;
  displayName: string | null;
};

/** Callback hosts the site worker is allowed to use. www is listed on its own. */
export const PRODUCTION_AUTH_ORIGINS = ["https://quki.cc", "https://www.quki.cc"] as const;

/**
 * Build the callback from the request URL only when its origin is an exact allowlist entry.
 * Forwarded Host headers are not an input.
 */
export function authCallbackUrl(requestUrl: URL, trustedOrigins: readonly string[]): string | null {
  if (requestUrl.username || requestUrl.password) return null;
  const origin = requestUrl.origin;
  if (!trustedOrigins.some((allowed) => allowed === origin)) return null;
  return `${origin}/api/auth/callback`;
}

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
  /** Must be the string `true` before any nonproduction origin is trusted. */
  AUTH_ALLOW_NONPRODUCTION_ORIGINS?: string;
  /** Comma-separated https origins. Ignored unless the flag above is `true`. */
  AUTH_NONPRODUCTION_HTTPS_ORIGINS?: string;
};

export function isGoogleIssuerUrl(issuer: URL): boolean {
  return (
    issuer.protocol === "https:" &&
    issuer.hostname === "accounts.google.com" &&
    issuer.port === "" &&
    (issuer.pathname === "/" || issuer.pathname === "") &&
    issuer.search === "" &&
    issuer.username === "" &&
    issuer.password === "" &&
    issuer.hash === ""
  );
}

/** Exact `iss` claim accepted for a new account. Scheme-less values are not this string. */
export function acceptedGoogleIdTokenIssuer(iss: string): boolean {
  return iss === GOOGLE_ISSUER;
}

function confirmedGoogleScopes(value: string | undefined): typeof GOOGLE_OIDC_SCOPES | null {
  const parts = (value ?? GOOGLE_OIDC_SCOPES).trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const names = new Set(parts);
  if (!names.has("openid") || !names.has("profile")) return null;
  return GOOGLE_OIDC_SCOPES;
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
  if (!isGoogleIssuerUrl(issuer)) return { ok: false, reason: "auth_not_configured" };
  const scopes = confirmedGoogleScopes(env.AUTH_OIDC_SCOPES);
  if (!scopes) return { ok: false, reason: "scopes_not_confirmed" };
  return { ok: true, config: { issuer, clientId, clientSecret, scopes } };
}

/** Production origins always stay. Extra https origins require an explicit nonproduction flag. */
export function trustedAuthOrigins(env: OidcEnv = {}): readonly string[] {
  const origins: string[] = [...PRODUCTION_AUTH_ORIGINS];
  if (env.AUTH_ALLOW_NONPRODUCTION_ORIGINS !== "true") return origins;
  for (const entry of (env.AUTH_NONPRODUCTION_HTTPS_ORIGINS ?? "").split(",")) {
    const text = entry.trim();
    if (!text) continue;
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) continue;
    if (url.pathname !== "/" && url.pathname !== "") continue;
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }
  return origins;
}

export function classifyOidcFailure(
  error: unknown,
): "provider_rejected" | "provider_unreachable" | "login_failed" {
  if (error instanceof oauth.AuthorizationResponseError || (error instanceof Error && error.name === "AuthorizationResponseError")) {
    return "provider_rejected";
  }
  if (error instanceof TypeError) return "provider_unreachable";
  return "login_failed";
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
      if (!claims?.sub || typeof claims.iss !== "string") throw new Error("missing_identity");
      if (!acceptedGoogleIdTokenIssuer(claims.iss)) throw new Error("issuer");
      if (claims.aud !== config.clientId) throw new Error("audience");
      const claimName = typeof claims.name === "string" ? claims.name : null;
      return { issuer: claims.iss, subject: claims.sub, displayName: publicDisplayName(claimName) };
    },
  };
}
