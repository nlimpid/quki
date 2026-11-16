import { createAuthStore, type AuthStore, type SqlConn } from "@quki/db";
import type { AuthUnavailableReason } from "@quki/types";

import {
  PRODUCTION_AUTH_ORIGINS,
  createOidcClient,
  readOidcEnv,
  type OidcClient,
  type OidcEnv,
} from "./oidc.js";

export type AuthRuntime = {
  now: () => Date;
  store: AuthStore | null;
  oidc: OidcClient | null;
  unavailableReason: AuthUnavailableReason | null;
  /** Exact request origins allowed to start login and receive the OAuth callback. */
  trustedOrigins: readonly string[];
};

export function unavailableAuth(): AuthRuntime {
  return {
    now: () => new Date(),
    store: null,
    oidc: null,
    unavailableReason: "auth_not_configured",
    trustedOrigins: PRODUCTION_AUTH_ORIGINS,
  };
}

export function authRuntimeFromEnv(
  env: OidcEnv & { TIDB_QUKI_DATABASE_URL?: string },
  connect: (url: string) => SqlConn,
  createClient: typeof createOidcClient = createOidcClient,
): AuthRuntime {
  const databaseUrl = env.TIDB_QUKI_DATABASE_URL?.trim() ?? "";
  const oidcEnv = readOidcEnv(env);
  if (!oidcEnv.ok || !databaseUrl) {
    return {
      now: () => new Date(),
      store: null,
      oidc: null,
      unavailableReason: !oidcEnv.ok ? oidcEnv.reason : "storage_unconfigured",
      trustedOrigins: PRODUCTION_AUTH_ORIGINS,
    };
  }
  return {
    now: () => new Date(),
    store: createAuthStore(() => connect(databaseUrl)),
    oidc: createClient(oidcEnv.config),
    unavailableReason: null,
    trustedOrigins: PRODUCTION_AUTH_ORIGINS,
  };
}
