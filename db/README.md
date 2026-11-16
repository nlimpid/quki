# Database

TiDB Serverless (MySQL protocol) via `@tidbcloud/serverless`.

- `migrations/0001_init.sql` — nine product tables and the four CSI seeds (000922/H00922, H30269/H20269).
- `migrations/0002_bars_nullable_ohlc.sql` — `open` / `high` / `low` nullable so close-only sessions can be stored. `close` stays required. Noted in the PR.
- `migrations/0006_auth.sql` — `auth_users`, `auth_sessions`, and `auth_oauth_transactions`. Not applied. It does not change dividend tables and is not a follow-up to `0005_dividend_audit.sql`.

`amount` is the CSIndex figure in **亿元**. `volume` is **shares**. See `data/SOURCES.md`.

Bookkeeping table `schema_migrations` is created by the runner, not by the product schema.

Apply with `TIDB_QUKI_DATABASE_URL` set:

```bash
pnpm migrate
pnpm backfill
```
