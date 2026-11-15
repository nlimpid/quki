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

Theme tokens live in `design/tokens.css` (imported by the app). Dividend pages add `design/tokens-dividends.css`, scoped to those routes. The index fetcher is `packages/ingest/src/csindex.ts`. A-share list and dividend fetchers are `packages/ingest/src/sinaList.ts` and `packages/ingest/src/eastmoneyDividends.ts`. Schema changes belong in `db/migrations`.

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

## 红利温度

`GET /api/temperature` is the daily 1–100 reading. High means expensive. The default is an equal-weight blend of two expanding percentiles: weekly close/MA55 on the price index (`000922` or `H30269`) and the 40-day total-return spread versus `H20903` (`H00985` is the robustness leg). The locked weights, the logistic and rule-tree alternatives, and the walk-forward tables are in `docs/temperature-v1-backtest.md`. Regenerate them with `pnpm temperature:backtest`. That command reads `data/seed` and does not write a database unless `--persist` is passed, and it refuses a URL whose database name is `quki`.

The overview payload for `000922`, `H00922`, `H30269`, and `H20269` includes a compact `temperature` object when a series is stored. `/index/:code` and `/rotation` are unchanged. The Worker reads stored `analytics_series` rows (`metric = temp_v1`); it does not recompute the history on the request. Local `pnpm dev` computes the same function from the seed CSVs.

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
```

Lint and format are oxlint and oxfmt. The web bundler is `rolldown-vite`. Libraries build with tsdown (`pnpm --filter "./packages/*" build`).

## Secrets

Never commit values. Names:

| Name                     | Where                                                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `TIDB_QUKI_DATABASE_URL` | Worker secret and local env. TiDB Serverless MySQL URL, for example `mysql://USER:PASSWORD@gateway01.<region>.prod.aws.tidbcloud.com:4000/quki` |
| `INGEST_TOKEN`           | Crawler Worker secret. `Authorization: Bearer …` or `x-ingest-token` on `POST /admin/migrate` and `POST /admin/ingest`                          |

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

The crawler cron is `30 8 * * MON-FRI` UTC (16:30 Asia/Shanghai) with a retry at `0 10 * * MON-FRI` UTC (18:00). Cloudflare cron weekdays are Quartz: `1` is Sunday and `7` is Saturday, so a numeric `1-5` runs Sunday–Thursday and never runs on Friday. `MON-FRI` is Monday–Friday. A third trigger, `30 12 * * MON-FRI` (20:30), runs the same incremental only when the session is still stale. It refetches from the last stored session through today and upserts. One request per index; it waits a second between symbols. Rotation recompute on the Worker only upserts a recent tail (or a short bootstrap if nothing is stored yet) so it stays inside the Worker time limit. The temperature step is the same: a full history is written by `pnpm backfill`, and the Worker cron only appends sessions newer than the stored temperature date. If the price leg or the total-return pair has not moved past that date, the retry does not upsert temperature rows.

`GET /api/health` stays `ok: true` when TiDB answers. It also reports `asOf` (`MAX(companies.updated_at)` for listed Shanghai and Shenzhen names, the same clock as the stock list), `indexThrough` (the earliest latest daily bar among active CSIndex instruments), `expectedSession`, `lastSuccess`, and `stale`. After 18:30 Asia/Shanghai on a trading day the expected session is that day; otherwise it is the previous Shanghai/Shenzhen session. Weekends and the 2026 SSE closures are not sessions. `stale` is true when `asOf` falls on an earlier Shanghai date, or when any active index is missing that session. `quoteFresh` is unchanged and is not this flag: it is per name, and it only means the latest crawl stored a positive trade. `.github/workflows/freshness.yml` requests this endpoint at 21:30 Asia/Shanghai on weekdays and again on Saturday morning. The workflow fails when `stale` is not `false`. That check uses GitHub's Unix cron (`1` = Monday), which is not the Cloudflare numbering above.

After the crawler is deployed, the same jobs can be triggered without a laptop copy of the database URL:

```bash
curl -X POST https://<quki-crawler>/admin/migrate -H "Authorization: Bearer $INGEST_TOKEN"
curl -X POST https://<quki-crawler>/admin/ingest -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "content-type: application/json" -d '{"mode":"incremental"}'
```

The CSV backfill stays a Node script: the seed files are not on the edge.

## A-share dividends

`/stocks`, `/stock/:code`, and `/portfolio` are Shanghai and Shenzhen A-shares (main board, ChiNext, STAR). Beijing and delisted names are excluded. The stock page has no K-line. Holdings stay in this browser under `qk.holdings.v1`. `/me` redirects to `/portfolio`. Login is not implemented.

近12月股息率 and a holding's 平均股息率 use the same formula: trailing 12 calendar months of pretax cash per share, divided by the latest close. Cash paid before a later bonus or transfer is divided by that split so it lines up with today's share count. Bonus and transfer shares are not cash. 「最近分红」is the ex-dividend date. A close the latest crawl did not refresh stays on the card in gray.

The same weekday cron refreshes the company list from Sina `Market_Center` `node=hs_a` (100 names per page, Beijing dropped) and dividends from Eastmoney `RPT_SHAREBONUS_DET`. The first run, or a missing watermark, walks every dividend page at 500 rows and writes `backfill:N` after each page so a timeout can resume. Later runs read `NOTICE_DATE` descending and stop 14 days behind the stored notice date. Only `实施分配` rows with an ex-dividend date and a non-zero cash, bonus, or transfer amount are stored. Upserts use `VALUES(col)`.

`POST /admin/ingest` runs that incremental dividend job in `waitUntil`. Send `{"dividends":"backfill"}` to walk history again, or `{"dividends":"skip"}` to leave it alone. `pnpm dev` serves a labeled sample book and does not call Sina, Eastmoney, or TiDB.

## Deploy with Workers Builds

Create two Workers Builds projects on this repo. Leave the root directory empty so both use the repository root. Production branch is `master`. Cloudflare installs dependencies itself: the root `pnpm-lock.yaml` and `"packageManager": "pnpm@10.33.4"` select pnpm. Do not set `SKIP_DEPENDENCY_INSTALL`.

| Setting        | Site `quki`                                          | Crawler `quki-crawler`                                  |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| Root directory | (repo root)                                          | (repo root)                                             |
| Build command  | `pnpm build:site`                                    | `pnpm build:crawler`                                    |
| Deploy command | `npx wrangler deploy -c workers/site/wrangler.jsonc` | `npx wrangler deploy -c workers/crawler/wrangler.jsonc` |

`build:site` compiles `apps/web`. `build:crawler` is a no-op; Wrangler bundles the crawler during deploy. Paths in each `wrangler.jsonc` are relative to that config file, so deploy from the repo root still finds `workers/site/src/index.ts` and the assets directory `apps/web/dist`. Assets stay a binding. They are not inlined into the script. `npx wrangler` uses the Wrangler version pinned in the root `devDependencies`.

Account `a0eb1f96a32491ca1f70971c118831fd`, zone `quki.cc`. Custom domains `quki.cc` and `www.quki.cc` stay in the site config.

First-time order: create the TiDB database, `pnpm migrate`, `pnpm backfill`, set `TIDB_QUKI_DATABASE_URL` on both Workers and `INGEST_TOKEN` on the crawler. `POST /admin/ingest` returns after the bar upsert and the temperature update; rotation rows are refreshed in `waitUntil` for the recent tail only. `pnpm backfill` still writes the full rotation history and the full temperature history. Local `pnpm dev` does not need any of that.
