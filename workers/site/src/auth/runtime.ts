import {
  createAuthStore,
  createHoldingStore,
  createIdentityStore,
  type AuthStore,
  type HoldingStore,
  type IdentityStore,
  type SqlConn,
} from "@quki/db";
import type { AuthUnavailableReason } from "@quki/types";

import {
  PRODUCTION_AUTH_ORIGINS,
  createOidcClient,
  readOidcEnv,
  trustedAuthOrigins,
  type OidcClient,
  type OidcEnv,
} from "./oidc.js";
import { readClerkEnv, type ClerkVerifyConfig } from "./clerkVerify.js";

export type AuthRuntime = {
  now: () => Date;
  store: AuthStore | null;
  /** Null until a database is configured. A missing auth_holdings table stays a 503. */
  holdings: HoldingStore | null;
  /** Public JWKS issuer. Null means Clerk is not configured. Not a secret key. */
  clerk: ClerkVerifyConfig | null;
  /** Null when the database URL is missing. A missing table stays a 503. */
  identities: IdentityStore | null;
  oidc: OidcClient | null;
  unavailableReason: AuthUnavailableReason | null;
  /** Exact request origins allowed to start login and receive the OAuth callback. */
  trustedOrigins: readonly string[];
};

export function unavailableAuth(): AuthRuntime {
  return {
    now: () => new Date(),
    store: null,
    holdings: null,
    clerk: null,
    identities: null,
    oidc: null,
    unavailableReason: "auth_not_configured",
    trustedOrigins: PRODUCTION_AUTH_ORIGINS,
  };
}

export function authRuntimeFromEnv(
  env: OidcEnv & {
    TIDB_QUKI_DATABASE_URL?: string;
    CLERK_JWT_ISSUER?: string;
    CLERK_AUTHORIZED_PARTIES?: string;
  },
  connect: (url: string) => SqlConn,
  createClient: typeof createOidcClient = createOidcClient,
): AuthRuntime {
  const databaseUrl = env.TIDB_QUKI_DATABASE_URL?.trim() ?? "";
  const oidcEnv = readOidcEnv(env);
  if (!oidcEnv.ok || !databaseUrl) {
    return {
      now: () => new Date(),
      store: null,
      holdings: databaseUrl ? createHoldingStore(() => connect(databaseUrl)) : null,
      clerk: readClerkEnv(env),
      identities: databaseUrl ? createIdentityStore(() => connect(databaseUrl)) : null,
      oidc: null,
      unavailableReason: !oidcEnv.ok ? oidcEnv.reason : "storage_unconfigured",
      trustedOrigins: trustedAuthOrigins(env),
    };
  }
  return {
    now: () => new Date(),
    store: createAuthStore(() => connect(databaseUrl)),
    holdings: createHoldingStore(() => connect(databaseUrl)),
    clerk: readClerkEnv(env),
    identities: createIdentityStore(() => connect(databaseUrl)),
    oidc: createClient(oidcEnv.config),
    unavailableReason: null,
    trustedOrigins: trustedAuthOrigins(env),
  };
}
