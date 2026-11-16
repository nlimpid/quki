# Account holdings and the homepage cash reference

No identity provider is selected. `LOGIN_UI_ENABLED` stays `false`. A signed-in session can save share counts, but this repository does not claim that login works in production.

Guests keep using `qk.holdings.v1` in this browser. Nothing in the session probe, logout, or homepage read writes that key. A signed-in import reads it only after the person clicks 查看本机持仓 and then 确认导入到账户. That import sets the confirmed quantities. It does not add them to the account quantity, and it does not clear the browser copy.

## Homepage reference

For a signed-in session, the index page requests `GET /api/holdings` and shows:

`近12个自然月已实施的税前每股现金 × 股数`

The per-share figure is `companies.ttm_cash_per_share`, already the trailing implemented pretax cash per current share. Unimplemented plans are not in the database and are not invented here. A name with a null cash figure or a null `yield_as_of` stays out of the total, and the total is marked incomplete. Cash is multiplied in 1e-8 CNY units from the decimal text returned by `CAST(... AS CHAR)`. A JavaScript number is not accepted as that input.

The worker does not serve this from the browser's local holdings.

## Screenshot import

The extractor interface is `VisionExtractor` in `workers/site/src/holdings/vision.ts`. Production passes `vision: null`. No DeepSeek client, key, or other model account is configured. Tests use a fixed synthetic fixture that ignores image bytes.

Before a configured extractor runs, the request must send `consent: "third-party-image-processing"`. The page states that a future provider would receive the image and that this site does not store it. The file control stays disabled while no provider is configured.

PNG validation inflates the IDAT stream and checks that the pixel-buffer length matches the header. JPEG validation uses `jpeg-js` with `tolerantDecoding: false` and checks the decoded RGBA length. Files over 1.5 MB, an edge over 4096, or more than 2 megapixels are rejected. That is below the zone upload cap (100 MB on Free and Pro) and the Worker 128 MB memory cap. These checks run in unit tests. They were not run inside a production isolate.

Reviewed text is stored inside the account document for ten minutes. The image, its base64 form, and account identifiers are not stored and are not written to logs. Model text is data: available shares are ignored, ambiguous quantities are not guessed, leading zeros stay, and a repeated code in one image does not add. The page shows those flags and asks for an explicit confirmation before `POST /api/holdings/apply`. Production leaves the file control disabled because no provider is configured. Tests inject a fetch double; there is no client switch that turns the synthetic fixture into recognition.

A JPEG or PNG with an EXIF orientation other than 1 is rejected. The decoder does not rotate pixels, so a turned screenshot is not read as if it were upright.

Before a vision call, the server records an attempt in the same account document. A timeout or failed extraction stays counted until the 10 minute window expires. Requests over the limit do not call the provider. `vision: null` returns 503 before that record.

Each account has one `auth_user_books` row. The items, the idempotency result, and draft consumption change together in a single `INSERT` or `UPDATE ... WHERE version = ?`. `@tidbcloud/serverless` 0.3.0 `begin()` exists on a dedicated connection, but this store does not call it and does not treat a shared `execute()` as a transaction. `rowsAffected` must be the number 1. A stale writer gets 0 and does not change the row. A thrown write leaves the previous document in place. This was exercised with an in-process stand-in and a fake connection, not on TiDB.

A save carries a time-bounded idempotency id, `op.v1.{timestampMs}.{uuid}`. The normal page flow puts that string in `GET /api/holdings` and in each successful save response, using the server clock. `GET` does not write it down. There is no issuance list and no signature. The string does not authenticate the caller. The session still has to be allowed to write that account. A freshly built string, or the same UUID with a new timestamp, is a new operation. It is accepted when it is inside the window and the account is under the cap. It is not a replay of an earlier save.

The clock is the server clock passed into the store. A timestamp more than 60 seconds ahead of that clock is rejected as malformed. A timestamp exactly 60 seconds ahead is still in range. A timestamp older than 10 minutes is expired, one millisecond past that mark included. A timestamp exactly 10 minutes old is still acceptable. Replay requires the original string, still inside that window, with the same payload hash. The response is the book stored for that string. The current book is not rewritten. After the string expires, sending it again returns 409 and does not apply it, even though its record may already have been removed.

This build keeps at most four unexpired saves and two unexpired drafts. A confirmed clear counts as one of the four. A fifth save, including a clear, returns 409, leaves the share counts as they are, and tells the person to wait until an earlier save is older than 10 minutes. The message says that clearing the account does not free a slot. The page keeps the form text and the screenshot draft. These caps are an implementation bound so the document cannot grow with every save. They are not an approved product quota, and a rollout should not describe holdings editing as unrestricted.

When the next accepted change runs, it drops expired save results, drafts, and vision attempts in the same compare-and-swap. That drop does not change share counts. A draft is consumed by the first id that commits it. Another id gets 409. After the draft expires it is gone; the same draft id cannot be applied or turned back into an unused preview. A stored document that is not the expected object, including a non-array `items` or `applies`, a bad share, code, version, draft, or attempt, throws before any write. The routes then return 503 and do not replace the book with an empty one.

Share quantities at the API are canonical decimal integers. `0x10`, `1e2`, signs, fractions, blanks, and leading zeros are rejected. A stock code is still a 6-character string, so `000001` stays `000001`.

## Migrations

Not applied in this change. `pnpm migrate` and `POST /admin/migrate` were not run. The crawler list still ends at `0005_dividend_audit.sql`.

| File | Depends on | Rollback |
| --- | --- | --- |
| `0006_auth.sql` | `0001`–`0005` already applied. No schema dependency on them. | Drop `auth_users`, `auth_sessions`, `auth_oauth_transactions`. No market rows change. |
| `0007_holdings.sql` | Apply only after `0006`. No foreign key. One `auth_user_books` row per account. The earlier unapplied per-row shape is replaced by this file and was not applied. | `DROP TABLE auth_user_books`. Saved share counts disappear. Market and dividend tables stay. |

There is no dual-write. If `0007` fails, `0006` can remain and the holdings routes return a storage error rather than a partial account book.

## Still required before this is a working product

- Choose the OIDC provider and the consent sentence, then set `LOGIN_UI_ENABLED`.
- Review and apply `0006` and `0007` on purpose. Do not apply `0007` first.
- Choose a vision provider, a server-side key, and the real consent sentence for that provider. The interface is ready; the provider is not.
- Run the holdings statements on TiDB. The memory stand-in and the recorded SQL are not that run.
- Check the signed-in homepage and the import screen in a browser. This change did not do that against a live session.
- Decide whether four saves and two drafts in ten minutes, with a clear counting as a save, is acceptable. That bound is not a product decision recorded here. Until it is, do not describe account editing as unrestricted. A full window waits out; it is not cleared by deleting holdings.
