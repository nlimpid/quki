# Login

Account login is Clerk email on `@clerk/react`. The Worker accepts one session path: `Authorization: Bearer` with a Clerk session JWT. `POST /api/auth/login`, `GET /api/auth/callback`, and the `qk_session` cookie do not authenticate. The browser does not copy `Cookie` or `__session` into the Worker check.

This file is the contract for review. It does not set secrets, run `pnpm migrate`, or deploy.

## Configuration

No secrets or publishable keys are in this repository. The public issuer is.

| Name                         | Where                 | Rule                                                                                                                                                                                                               |
| ---------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_CLERK_PUBLISHABLE_KEY` | `pnpm build:site`     | Clerk publishable key. Never a secret. It must be in the process that runs `pnpm build:site`, because Vite inlines it into the page. A Worker runtime setting does not reach a build that omitted it. The sign-in form renders only when this built key is present and the Worker session is ready. This repository does not contain the key. |
| `CLERK_JWT_ISSUER`           | Site Worker `vars`    | Public value `https://clerk.quki.cc` in `workers/site/wrangler.jsonc`. Not a secret. Exact `https` origin of the Clerk Frontend API. No user, password, query, or hash. The JWKS URL is `{that origin}/.well-known/jwks.json`. The token `iss` is checked against this origin and is never a fetch URL. |
| `CLERK_AUTHORIZED_PARTIES`   | Site Worker, optional | Comma-separated `azp` allowlist. The code default is `https://quki.cc,https://www.quki.cc`. A token without `azp`, or with an `azp` outside the list, is rejected.                                                 |
| `CLERK_SECRET_KEY`           | unused                | Session verification does not call the Clerk Backend API. Do not set it for this release.                                                                                                                          |
| `CLERK_JWT_KEY`              | unused                | Not read. A static PEM is not required. The Worker imports RSA keys from the public JWKS `{CLERK_JWT_ISSUER}/.well-known/jwks.json`.                                                                               |

`TIDB_QUKI_DATABASE_URL` is required for the identity store. A missing or invalid issuer leaves `login.ready: false` with `auth_not_configured`. A valid issuer with no database URL leaves `login.ready: false` with `storage_unconfigured`. Leftover `AUTH_OIDC_*` variables do not change that.

## Session JWT

The Worker verifies the bearer with WebCrypto against the issuer JWKS. Algorithms are RS256, RS384, and RS512. Clock skew is 5 seconds. The JWKS cache is 10 minutes and is refetched when `kid` is unknown.

The header `cat` must be exactly `cl_B7d4PD111AAA` (the session category pinned from `@clerk/backend@3.30.0`). If Clerk changes that category, verification must fail closed. A missing or different category is not a session token. A missing `aud` is accepted because Clerk session tokens use `azp` for the party. A present `aud` must be the issuer origin or one authorized party; any other audience is rejected.

`CLERK_AUTHORIZED_PARTIES` entries must be `https` origins, or `http://localhost` / `http://127.0.0.1` for local development. A path, query, wildcard, or other `http` host makes login unavailable. The production default is `https://quki.cc,https://www.quki.cc`. The sign-in component is Clerk email code with sign-up on the same form. It does not add Google, a password field, or OCR. The Clerk instance itself must leave those methods off.

`isSignedIn` in the browser does not authorize a route. `getToken()` may be null; the client omits `Authorization` in that case. An account page opens only after `GET /api/auth/session` returns 200 with `authenticated: true`.

## Identity

The verified `iss` and `sub` are stored as exact `VARBINARY(512)` bytes and mapped to an internal UUID `CHAR(36)`. That UUID is `user.id` and `auth_holdings.user_id`. A unique-key race reads the same pair back and returns the existing UUID. There is no email column and no email merge. Clerk user ids are not stored in `CHAR(36)`.

## API

`/api/auth/*` responses send `Cache-Control: no-store`.

### `GET /api/auth/session`

Anonymous, no `Authorization` header:

- `200`, `authenticated: false`.
- `login.ready: true` and `login.method: "clerk"` only when `CLERK_JWT_ISSUER` passes `readClerkEnv` and the identity store exists.
- Otherwise `login.ready: false`, `login.method: null`, and `reason` is `auth_not_configured` or `storage_unconfigured`.

With `Authorization: Bearer`:

- `401` when the token is malformed or the signature, issuer, `azp`, time, or session category fails.
- `503` when Clerk or the identity table is unavailable. `authenticated` stays false.
- `200` with the internal UUID when verification and the identity read succeed.

A `qk_session` or `__session` cookie is ignored.

### Closed OIDC routes

`POST /api/auth/login` and `GET /api/auth/callback` return `404` `{ "error": "not_found" }`. They set no cookie and no `Location`.

### `POST /api/auth/logout`

Same-origin `Origin` is required (`403` otherwise). The body is not a CSRF cookie. `Authorization: Bearer` uses the same verification as holdings. Success is `204`. A cookie alone is `401`.

### `GET /api/account` and `GET /api/users/:userId`

Same bearer check. `401` without a valid bearer. `403` when the path id is not the internal UUID. The response user is `{ "id", "displayName": null }`.

Market routes stay public and do not read the session.

## Holdings

`PUT` and `DELETE` on `/api/holdings` require the same bearer and a same-origin mutation. A missing holdings table is `503` and writes nothing. Share counts are integers from 1 through 1,000,000,000. The code must be a listed Shanghai or Shenzhen company. `expectedVersion` is 32 lowercase hex; `null` is allowed only when creating. Versions are random and are not reused.

The browser key `qk.holdings.v1` stays readable and is never uploaded, merged, or cleared by login or logout. A signed-in portfolio can show 保存到账户 for those rows. Nothing is sent until 确认保存. Cancel sends nothing. Switching accounts clears that confirmation. Guest add goes to `/login?returnTo=` with a same-origin path. The add intent is opened again only after the Worker session returns 200 authenticated. Explicit logout returns to a same-origin path from `logoutReturnUrl`. A rejected bearer signs out without that redirect, then reads `/api/auth/session` once with no `Authorization` header. A 503 or network error does not sign out.

## UI

The header shows 登录 when the probe is unknown, and when the guest session has `login.ready: true`. It shows 账户 for an authenticated session.

`/login` shows the Clerk `SignIn` form only when the publishable key and `login.ready` are both present. It shows `登录暂不可用。访客仍可查看行情。此浏览器里的旧持仓只供查看。` only when login is unconfigured. The form and that card are not shown together. Redirects use `forceRedirectUrl` and `fallbackRedirectUrl` from `safeReturnTo`.

## Review SQL

Do not run `pnpm migrate`. That command applies every `db/migrations/*.sql` whose filename is missing from `schema_migrations`, including `0006_auth.sql`. We do not execute it. Whether production has applied `0006_auth.sql` was NOT CHECKED. Do not describe that file as unapplied. The crawler list stays `0001` through `0005`.

These two files are outside `db/migrations`, so migrate does not see them. `pnpm auth:sql:review` prints only these paths, in this order, and does not connect:

1. `db/review/0009_auth_identities.sql`
2. `db/review/0008_auth_holdings.sql`

`--execute` prints `Refusing to execute. Production applied state was NOT CHECKED. This is not pnpm migrate.` and exits without a connection.

## Not verified

The JWT checks use a labelled fixture key, not a Clerk account. The identity and holdings stores use an in-process stand-in, not TiDB. No secret is set and nothing here is a release.
