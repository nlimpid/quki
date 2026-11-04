# quki.cc

Daily (and longer) index history, a 55-week moving-average study, and the charts for it. Phase 1 is two CSI price indices:

| Code   | Name     | Total-return twin (seeded, not on the phase-1 chart) |
| ------ | -------- | ---------------------------------------------------- |
| H30269 | 红利低波 | H20269                                               |
| 000922 | 中证红利 | H00922                                               |

The page is the product. There is no separate written report.

## Layout

```
apps/web            React 19 + rolldown-vite + Tailwind v4 + React Router 7 + ECharts 5
workers/site        Cloudflare Worker: /api + static assets for quki.cc
workers/crawler     Cron Worker: CSIndex daily bars → TiDB, then recompute
packages/types      Shared DTOs and the instrument list
packages/analytics  Weekly bars, MA55, percentile, significant lows, backtest hook
packages/ingest     CSV seed reader and the CSIndex fetcher (swap this to change source)
packages/db         TiDB client, migrations, upserts
db/migrations       Schema
data/seed           Full-history CSVs through 2026-11-03
data/SOURCES.md     Endpoint notes and quirks
design              SPEC, tokens, HTML mockups
```

Theme tokens live only in `design/tokens.css` (imported by the app). The fetcher is `packages/ingest/src/csindex.ts`. Schema changes belong in `db/migrations`.

## Data source

Primary fetch (no auth, works from Cloudflare egress):

```
GET https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=CODE&startDate=YYYYMMDD&endDate=YYYYMMDD
```

Do not use Eastmoney `push2his` from Workers; TLS fails from Cloudflare IPs. Details, units, and rejected fallbacks are in `data/SOURCES.md`.

- `volume` is shares (股).
- `amount` is **亿元** CNY, stored as published (not multiplied by 1e8).
- H20269 / H00922 are close-only. H30269 is close-only from 2016-06-14 through mid-2018, including a flat zero-volume row on 2018-06-18. Missing open/high/low stay null. Weekly high/low and the significant-low rule fall back to that day's close. The chart draws a close line where OHLC is missing.
- If `startDate` is not a session, CSIndex can emit a phantom row that clones the next bar. Incremental crawls start on the last stored session and dedupe on `(instrument, date)`.

Weekly bars are ISO weeks (Monday start). `trade_date` is the last session in the week, which is Friday when Friday traded. The current week is marked 当周未收盘 until that Friday.

## Analytics

`55周均线偏离度` = weekly close / 55-week simple moving average of weekly closes. The partial current week is included.

Historical percentile is the share of weekly close/MA55 readings, from the first week the average exists through the latest week, that are **strictly below** the current reading. The page shows that as an integer. Lower means cheaper relative to this index's own history.

A significant low is a week whose effective low / MA55 is the minimum inside ±13 weeks **and** is below 95%. If fewer than 13 weeks follow it, the row is 未确认. Tags: below 85% 史诗底, below 90% 重要底.

Checked against the seed file for H30269 **as of 2026-06-29** (that session's close is 10204.61):

|                               |                                       |
| ----------------------------- | ------------------------------------- |
| MA55                          | 11303.63                              |
| close / MA55                  | 90.28%                                |
| 90% of MA55                   | ≈ 10173                               |
| 85% of MA55                   | ≈ 9608                                |
| 2016-01 low                   | 78.6%                                 |
| 2018-10 low                   | 79.7%                                 |
| 2020-03 low                   | 86.2%                                 |
| week of 2026-06-29 low / MA55 | 88.07% (unconfirmed, week not closed) |

The full-sample percentile of that 90.28% reading is about **13%**, not 8.2%. The 8.2% figure is Excel `PERCENTRANK.INC` on the subsample that starts 2015-01-01 (8.18%, which rounds to 8.2% at one decimal). The moving average, tiers, and the lows above match on the full CSIndex history; the gap is the sample window and the rank formula, which the unit test locks in.

## 轮动三棱镜

`/rotation` compares 红利 with the broad market. The pair list is `ROTATION_PAIRS` in `packages/types`. Default legs are total return, because both benchmarks have a total-return twin:

|        | 红利   | 基准                                           |
| ------ | ------ | ---------------------------------------------- |
| 全收益 | H00922 | H20903 中证A股全收益，或 H00985 中证全指全收益 |
| 价格   | 000922 | 930903 中证A股，或 000985 中证全指             |

On aligned sessions, R = A/B rebased to 1 at the first common day. Bollinger is MA242(R) ± 2 population standard deviations. S is the 40-day return spread. RSI14 uses Wilder smoothing. 930903 and H20903 include a 1999-12-31 row that clones 2005-01-04; ingest drops it, so history starts 2005-01-04. Dates that exist on only one leg are dropped (930903 currently runs through 2026-11-04 while 000985 stops at 2026-11-03).

The crawler fetches these codes from the same CSIndex endpoint. `pnpm backfill` loads `data/seed`. Recompute writes `rot_r`, `rot_r_ma242`, `rot_r_upper`, `rot_r_lower`, `rot_pct_b`, `rot_bandwidth`, `rot_s`, `rot_s_ma242`, `rot_rsi14`, and `rot_rsi_ma242` into `analytics_series` under the A instrument, versioned by pair params.

Backtests are not on the page yet. `packages/analytics/src/backtest.ts` registers `ma55_band` (buy when weekly close/MA55 &lt; 90%, sell back at 100%). Results belong in `backtest_runs` / `backtest_trades` / `backtest_equity`. Use the total-return codes for a dividend backtest.

## Local development

```bash
pnpm install
pnpm dev
```

- Web: http://127.0.0.1:5173 (defaults to `/index/H30269?period=W&range=5Y&vol=0`)
- API: http://127.0.0.1:8787

`pnpm dev` serves the API from `data/seed/*.csv` and does not need TiDB. Copy `.dev.vars.example` to `.dev.vars` when you want the real database.

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format
pnpm test:integration   # skips with a notice until TIDB_CI_DATABASE_URL is set
```

Lint and format are oxlint and oxfmt. The web bundler is `rolldown-vite`. Libraries build with tsdown (`pnpm --filter "./packages/*" build`).

## Secrets

Never commit values. Names:

| Name                     | Where                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TIDB_QUKI_DATABASE_URL` | Worker secret and local env. TiDB Serverless MySQL URL, for example `mysql://USER:PASSWORD@gateway01.<region>.prod.aws.tidbcloud.com:4000/quki`                         |
| `TIDB_CI_DATABASE_URL`   | GitHub Actions secret only. A separate database on that cluster, for example `quki_ci`. Never production `quki`. See [Continuous integration](#continuous-integration). |
| `INGEST_TOKEN`           | Crawler Worker secret. `Authorization: Bearer …` or `x-ingest-token` on `POST /admin/migrate` and `POST /admin/ingest`                                                  |

```bash
# from workers/site and workers/crawler respectively
pnpm exec wrangler secret put TIDB_QUKI_DATABASE_URL
pnpm exec wrangler secret put INGEST_TOKEN
```

## Database, backfill, cron

```bash
# .dev.vars or the shell must define TIDB_QUKI_DATABASE_URL
pnpm migrate    # db/migrations, tracked in schema_migrations
pnpm backfill   # load data/seed/*.csv and recompute weekly analytics
pnpm ingest     # incremental CSIndex pull (add --backfill for a full API history)
```

`0001_init.sql` is the nine-table schema (instruments, bars, analytics_series, significant_lows, backtest_runs, backtest_trades, backtest_equity, crawl_runs, crawl_watermarks) plus the four seeds. `0002_bars_nullable_ohlc.sql` allows null open/high/low. The runner also creates `schema_migrations`.

The crawler cron is `15 8 * * 1-5` UTC (16:15 Asia/Shanghai), weekdays, after the cash close. It refetches from the last stored session through today and upserts. One request per index; it waits a second between symbols. Rotation recompute on the Worker only upserts a recent tail (or a short bootstrap if nothing is stored yet) so it stays inside the Worker time limit.

After the crawler is deployed, the same jobs can be triggered without a laptop copy of the database URL:

```bash
curl -X POST https://<quki-crawler>/admin/migrate -H "Authorization: Bearer $INGEST_TOKEN"
curl -X POST https://<quki-crawler>/admin/ingest -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "content-type: application/json" -d '{"mode":"incremental"}'
```

The CSV backfill stays a Node script: the seed files are not on the edge.

## Deploy with Workers Builds

Create two Workers Builds projects on this repo. Leave the root directory empty so both use the repository root. Production branch is `master`. Cloudflare installs dependencies itself: the root `pnpm-lock.yaml` and `"packageManager": "pnpm@10.33.4"` select pnpm. Do not set `SKIP_DEPENDENCY_INSTALL`.

| Setting        | Site `quki`                                          | Crawler `quki-crawler`                                  |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| Root directory | (repo root)                                          | (repo root)                                             |
| Build command  | `pnpm build:site`                                    | `pnpm build:crawler`                                    |
| Deploy command | `npx wrangler deploy -c workers/site/wrangler.jsonc` | `npx wrangler deploy -c workers/crawler/wrangler.jsonc` |

`build:site` compiles `apps/web`. `build:crawler` is a no-op; Wrangler bundles the crawler during deploy. Paths in each `wrangler.jsonc` are relative to that config file, so deploy from the repo root still finds `workers/site/src/index.ts` and the assets directory `apps/web/dist`. Assets stay a binding. They are not inlined into the script. `npx wrangler` uses the Wrangler version pinned in the root `devDependencies`.

Account `a0eb1f96a32491ca1f70971c118831fd`, zone `quki.cc`. Custom domains `quki.cc` and `www.quki.cc` stay in the site config.

First-time order: create the TiDB database, `pnpm migrate`, `pnpm backfill`, set `TIDB_QUKI_DATABASE_URL` on both Workers and `INGEST_TOKEN` on the crawler. `POST /admin/ingest` returns after the bar upsert; rotation rows are refreshed in `waitUntil` for the recent tail only. `pnpm backfill` still writes the full rotation history. Local `pnpm dev` does not need any of that.

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests and on pushes to `master`. pnpm comes from the root `packageManager` field (`pnpm@10.33.4`).

| Check            | Job name         | What it runs                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci`             | `ci`             | `pnpm install --frozen-lockfile`, `oxfmt --check`, `oxlint`, `tsc --noEmit` for every package, unit tests, `pnpm build:site`, `pnpm build:crawler`, and `npx wrangler deploy --dry-run` for both workers                                                                                                                                                  |
| `db-integration` | `db-integration` | Real TiDB Serverless via `@tidbcloud/serverless`. Applies `db/migrations`, inserts two instruments and 120 weekly sessions, then reads them back through `listInstrumentIds`, the overview and rotation queries, the crawler `ON DUPLICATE KEY UPDATE` upsert, and the site worker's `/api/health`, `/api/instruments`, and `/api/indices/:code/overview` |

On GitHub the checks are `ci` and `db-integration`. The branch-protection picker sometimes shows them as `ci / ci` and `ci / db-integration`. Require both on `master` before merging.

`db-integration` needs the repository secret `TIDB_CI_DATABASE_URL`. Create a second database on the same TiDB Serverless cluster (do not reuse production `quki` — the job drops every table):

```sql
CREATE DATABASE quki_ci;
```

Copy the production connection string and change the database path from `/quki` to `/quki_ci`. In GitHub: Settings → Secrets and variables → Actions → New repository secret, name `TIDB_CI_DATABASE_URL`. The same cluster user is fine. The test refuses a URL whose database is `quki`.

Fork pull requests do not receive the secret. The job then prints a notice and succeeds, so it does not prove the database path on those runs.

Locally:

```bash
export TIDB_CI_DATABASE_URL='mysql://USER:PASSWORD@gateway01.<region>.prod.aws.tidbcloud.com:4000/quki_ci'
pnpm test:integration
```

Without that variable the same command prints a notice, skips the live suite, and exits 0.

## Production smoke

`.github/workflows/smoke.yml` runs on every push to `master`, every 30 minutes, and from the Actions tab (`workflow_dispatch`). It curls `https://quki.cc/api/health` (`ok` true and `instruments` > 0), `/api/instruments` (non-empty), `/api/indices/H30269/overview` (HTTP 200 with `lastClose`), and `https://quki.cc/` (HTTP 200). A push retries for about five minutes so Workers Builds can finish. A failure fails the workflow, which is the alert GitHub emails to the repository owner.

A push can still pass against the previous deploy if the site is already healthy. The half-hour schedule is what catches a bad deploy that finishes after that first probe. This check is not a merge requirement.
