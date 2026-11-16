# Login MVP

Provider-neutral session shell for quki.cc. No identity provider is selected. The `/login` card does not collect credentials and does not offer a branded or placeholder sign-in button. Anonymous market routes stay public. Holdings remain in `qk.holdings.v1` on this browser.

This file is the contract for review. It does not apply the migration, set secrets, or deploy.

## Recommendation

Use opaque server sessions in the existing TiDB database, and use `oauth4webapi` for the OIDC authorization-code flow when the owner names an issuer.

`oauth4webapi` 3.8.8 is the OAuth/OIDC client inside Auth.js. It runs on Cloudflare Workers, generates PKCE (`S256`) and `state`, and checks the authorization response and ID token with Web Crypto. The site Worker already has `nodejs_compat` and talks to TiDB through `@tidbcloud/serverless` over HTTP. Session rows use that same parameterized `execute(sql, params)` client. The browser receives an opaque cookie. The database stores only the SHA-256 of that cookie.

These alternatives do not fit this app:

| Option | Why it is not the default |
| --- | --- |
| Better Auth + `mysql2` | The maintained MySQL adapter expects a TCP pool. Workers cannot hold that pool, and TiDB Serverless from this Worker uses the HTTP driver, not Hyperdrive. Adding Hyperdrive would be a production network change. |
| Better Auth + `@tidbcloud/kysely` | Better Auth lists the TiDB Kysely dialect, but the published dialect is 0.0.4 from 2023 (about 200 weekly downloads) against Kysely 0.26. That is not a current Workers path. |
| Lucia / Arctic / Oslo | Arctic is deprecated. Oslo's maintained package is `@oslojs/encoding` only. Copying their old session guide would mean maintaining the crypto ourselves. |
| Auth.js MySQL adapter | Same TCP driver problem as `mysql2`, unless a custom adapter is written on top of `@tidbcloud/serverless`. That is more glue than calling the driver directly. |
| Email, password, SMS, WeChat, GitHub, or Google | Each one is an owner decision. The audience is a Chinese market page with no mailer and no user table. This change does not pick one. |

Tradeoff: the OIDC callback is implemented and tested with an in-process stand-in. `login.ready` on `GET /api/auth/session` only means the Worker has a database URL and an `openid` issuer configured. The page does not treat that as a working sign-in. `LOGIN_UI_ENABLED` in `apps/web/src/lib/authState.ts` stays `false` until a provider is chosen and a real consent sentence replaces the empty one. Until then the header and the expiry banner do not offer 登录 or 重新登录, and `/login` says `登录暂不可用`. There is no 继续登录 button.

`pnpm dev` keeps using seed CSVs. It does not open TiDB for login.

## Owner checklist

Names only. Do not create the provider account in this change.

1. Choose an OIDC issuer that supports authorization code, PKCE `S256`, a confidential client secret, and a discovery document.
2. Register both callback URLs:
   - `https://quki.cc/api/auth/callback`
   - `https://www.quki.cc/api/auth/callback`
   The callback is derived from the request host. There is no separate redirect env var.
3. Set site Worker secrets:
   - `AUTH_OIDC_ISSUER` — `https` URL, no userinfo in the URL
   - `AUTH_OIDC_CLIENT_ID`
   - `AUTH_OIDC_CLIENT_SECRET`
   - `AUTH_OIDC_SCOPES` — omit it, or set exactly `openid`. `email`, `profile`, or `phone` keep login unavailable so the consent placeholder is not a lie.
4. Apply `db/migrations/0006_auth.sql` with `pnpm migrate` after review. It is not applied here. It does not modify dividend tables and does not depend on `0005_dividend_audit.sql`.
5. Choose the provider, write the real consent sentence, then set `LOGIN_UI_ENABLED` and add the unbranded 继续登录 control that posts to `POST /api/auth/login`. Do not flip the flag while the consent text is still missing. `login.ready: true` alone does not show that button.
6. Local `http://127.0.0.1` will not keep the session cookie, because `Secure` is always set. Exercise login on HTTPS.

`TIDB_QUKI_DATABASE_URL` is still required for any real session read. Missing issuer, client, secret, or database leaves `login.ready: false`. A storage error during a configured request is HTTP 503 and does not describe the user as logged out.

## Cookies

| Cookie | Value | Flags | Lifetime |
| --- | --- | --- | --- |
| `qk_session` | 32 random bytes, base64url | `Secure`; `HttpOnly`; `SameSite=Lax`; `Path=/`; no `Domain` | 14 days (`Max-Age=1209600`). Also enforced with `expires_at`. |
| `qk_csrf` | CSRF token for `POST /api/auth/login` | same flags | 1 hour |
| `qk_oauth` | opaque id for one authorization attempt | same flags | 10 minutes |

The session row stores `sha256(qk_session)`, not the cookie. Logout sets `revoked_at` and `Max-Age=0`. An expired or revoked cookie is treated as anonymous with `expired: true`. There is no sliding renewal.

## API

All `/api/auth/*` responses send `Cache-Control: no-store`.

### `GET /api/auth/session`

`200` when the process can answer. `503` `{ "error": "auth_unavailable", "message": "登录暂不可用" }` when the store throws. A 503 is a probe failure, not a logout.

```json
{
  "status": "anonymous",
  "authenticated": false,
  "expired": false,
  "user": null,
  "csrfToken": "string or null",
  "login": { "ready": false, "method": null, "reason": "auth_not_configured" }
}
```

`status` is `anonymous`, `authenticated`, or `unavailable`.

`user` is `{ "id", "displayName" }` or `null`. `displayName` is omitted from the label when it is empty, an email address, or a phone number. The menu then shows `已登录`. Email and phone are not stored and are not returned.

`login.reason` is `auth_not_configured`, `storage_unconfigured`, `scopes_not_confirmed`, or `null`. `login.method` is `oidc` only when `ready` is true.

`expired: true` means a session cookie was sent and the row is missing, expired, or revoked.

### `POST /api/auth/login`

JSON or form body: `{ "csrf": "...", "returnTo": "/portfolio?edit=1" }`. A `userId` field is ignored.

- `403` `{ "error": "csrf" }` when `Origin` is missing or not this host, `Sec-Fetch-Site` is `cross-site`, or `csrf` does not match `qk_csrf`.
- `503` when login is not configured or the issuer cannot be reached. No `Location`, no session cookie.
- `302` to the discovered HTTPS authorization endpoint. Sets `qk_oauth`. PKCE and `state` stay on the server. The URL is not the `returnTo` value.

### `GET /api/auth/callback`

IdP redirect. `state` must match the stored transaction and `oauth4webapi` validates it again. The code verifier and nonce come from that transaction, not from the query. The transaction is deleted before the code is exchanged. Success sets `qk_session` and redirects to the stored same-origin path. Failure redirects to `/login?error=login_failed&returnTo=...` and does not set a session. A `returnTo` on the callback query is ignored.

The ID token `sub` is the only account key (`provider = "oidc"`). `name` / `preferred_username` is stored only after `publicDisplayName`. Access tokens and refresh tokens are not stored.

### `POST /api/auth/logout`

JSON `{ "csrf" }` or header `X-CSRF-Token`. Same origin rule as login.

- `403` when the session is valid and the token does not match the row. The session stays.
- `204` after `revoked_at` is set, or when there was no session. Clears `qk_session`.
- `503` when the store throws. The cookie is left in place so the client cannot pretend the logout worked.

### `GET /api/account`

- `401` `{ "error": "unauthorized", "message": "需要登录" }` with no valid session.
- `200` `{ "user": { "id", "displayName" } }` for the session user.
- Query `userId` is ignored.
- `503` when the session row cannot be read.

### `GET /api/users/:userId`

- `401` when anonymous or expired.
- `403` `{ "error": "forbidden", "message": "无权访问该账户" }` when the path id is not the session user. The other row is not loaded.
- `200` with the same user object when the path id matches.

Market routes are unchanged and do not read the session.

## Redirects

`returnTo` is accepted only as a same-origin `pathname + search`:

- Missing, empty, or undecodable values become `/`.
- A leftover `%2F`, `%5C`, or `%3A%2F%2F` after one decode becomes `/`.
- `//`, `/\`, `\`, `://`, another origin, control characters, and `/login` become `/`.
- The hash is dropped.

The header link is `/login?returnTo=` plus the current path, except on `/login` itself, which does not nest another `returnTo`.

## Holdings

Auth modules do not read or write `localStorage` or `qk.holdings.v1`. Login, logout, expiry, and a failed logout do not upload, merge, or delete holdings. The portfolio drawer is React state owned by that page; the expiry banner does not navigate or reset it.

Copy:

- Guest portfolio: `本地保存 · 未登录。数据仅保存在此浏览器，清除站点数据会丢失。登录不会上传本地持仓。`
- Signed-in portfolio, including a failed logout: `本地保存。持仓仍仅保存在此浏览器，不会因登录而同步到云端。`
- Session still unknown: the guest sentence without `未登录`.
- Add/edit footnote: `数据仅保存在此浏览器，清除站点数据会丢失。登录不会上传或同步持仓。`

## UI states

| State | Header | Meaning |
| --- | --- | --- |
| `initializing` | 16px spinner, at most 4 seconds | Probe in flight. Pages stay usable. |
| `unknown` | `登录` as a session check | Timeout, network error, or HTTP 503. Not logged out. `/login` says `无法确认登录状态，请重试。` A late `200` still updates the header. |
| `guest` and login not offered | no 登录 link | Includes `login.ready: false` (`auth_not_configured`, `storage_unconfigured`, `scopes_not_confirmed`) and `login.ready: true` while `LOGIN_UI_ENABLED` is false. `/login` says `登录暂不可用。访客仍可查看行情，并在本机管理持仓。` 重试 only probes the session again. |
| `guest` + `expired` | dismissible banner, no 重新登录 while login is not offered | Previous cookie is dead. Unsaved holdings edits stay. |
| `authenticated` | `账户` | Still shown when `login.ready` is false. Menu label is `displayName` or `已登录`. |
| `logoutPending` | `账户`, menu says `正在退出…` | Second submit disabled. |
| `logoutFailed` | `账户` stays | Menu says `退出失败，请重试。` There is no `已退出` string. |

The account panel is not a focus trap. Opening it moves focus to 退出. Escape closes it and returns focus to 账户. Tab and Shift+Tab leave the panel and close it.

Unresolved: which OIDC provider to use, and the consent sentence for what that provider collects. Those two choices gate `LOGIN_UI_ENABLED`. The API can report `login.ready: true` before either choice is made.

## Tests

```bash
pnpm test
pnpm typecheck
pnpm --filter @quki/web build
pnpm lint
```

Covered in process, with no network and no database:

- Anonymous `/api/health` and `/api/instruments` with and without a session cookie.
- Unavailable login (`503`, no session cookie) when OIDC env is absent.
- Cookie flags, CSRF on login and logout, revoked logout, 14-day expiry.
- `401` versus `403`, ignored caller `userId`, two subjects isolated.
- Open redirects, callback `state` mismatch, one-time OAuth transaction, PKCE challenge from `oauth4webapi`.
- Storage errors do not echo the driver URL.
- `authRuntimeFromEnv` does not call `connect` until a query runs.
- Display-name filter, `returnTo`, and the 4 second unknown state.
- Header and relogin stay hidden for `auth_not_configured`, `storage_unconfigured`, `scopes_not_confirmed`, and for `login.ready: true` while `LOGIN_UI_ENABLED` is false. An existing session still shows 账户.
- Auth client and auth modules do not touch `qk.holdings.v1`.

These checks use an in-process stand-in for the auth tables. They do not open TiDB, an issuer, or a browser.

Local run for the login-shell correction: `pnpm test` passed (29 files, 128 tests), `pnpm typecheck` passed, `pnpm lint` passed with three existing effect-dependency warnings in `RotationChart`, `KlineChart`, and `OverviewPage`, and `pnpm --filter @quki/web build` passed. Those tests use an in-process auth stand-in. They are not a TiDB, issuer, or browser run, and they are not a security approval.

Not covered: a live issuer, a real TiDB connection, applying `0006_auth.sql`, a browser click-through, or wrangler deploy. `0005_dividend_audit.sql` was not edited or rerun.
