# Dividend compare tolerances

Golden sample: `600036` 招商银行, `601919` 中远海控, `600519` 贵州茅台, `000001` 平安银行. Each stock contributes its latest 3 implemented (`实施分配`) events. Versioned JSON lives next to this note.

| Field                                                 | Tolerance                 |
| ----------------------------------------------------- | ------------------------- |
| `cash_div_pretax_per_10` (yuan per 10 shares, pretax) | ±0.001                    |
| `equity_record_date`                                  | zero (exact `YYYY-MM-DD`) |
| `ex_dividend_date`                                    | zero (exact `YYYY-MM-DD`) |

Sina sometimes prints one fewer decimal than Eastmoney and cninfo. 贵州茅台 `2026-06-26` is Eastmoney/cninfo `280.2423` and Sina `280.242`. That gap is inside ±0.001 and is `MATCH`. A tolerance of `0.0001` flags it. Do not tighten cash without revisiting that row.

Dates do not use a day offset. A different record date or ex-dividend date is a break.

## How to run

Offline (default CI and local). No network and no database:

```bash
pnpm dividends:check
pnpm test
```

`pnpm dividends:check` loads the fixtures, runs parser A vs parser B, reconciles Eastmoney vs cninfo (primary) and Sina (secondary), scans the missed-event fixture, and checks pre-insert invariants on the golden rows. It prints a breaks CSV. Exit code is 1 when any offline check fails.

Live Eastmoney refetch for the four codes (still no database write):

```bash
DIVIDEND_GOLDEN_LIVE=1 pnpm dividends:check
```

Sina HTML and cninfo are not refetched. Their fields in `golden-implemented-v1.json` are the offline primary/secondary sources. SSE and baostock are not gates.

## Source priority

On a paired conflict, cninfo replaces Eastmoney for pretax cash per 10 shares (when the gap is greater than 0.001, or Eastmoney cash is missing) and for pay date and ex-dividend date when cninfo has a different value. Both plan texts and both numeric values stay on the audit columns. Sina never overrides.

`db/migrations/0005_dividend_audit.sql` adds those columns. It is not applied to production by this change. The daily Eastmoney upsert does not write them, so the crawler still runs before the migration. `writeDividendSourceAudit` refuses a database named `quki`.

## Crawl quality log

Each dividend ingest inserts one `crawl_runs` row (`job_name = dividends_events`, `source = eastmoney`). `request_meta` holds invariant row failures, the golden-sample pass rate for events that showed up in that crawl, and Eastmoney fetch latency. An incremental crawl that does not include the golden ex-dates records `passRate: null` rather than a fake 100%.

## Read-only SQL

`db/checks/dividend_invariants.sql` selects rows that violate `ex_dividend_date >= equity_record_date`, non-negative cash/bonus/transfer, or a duplicated `event_key`. Do not point it at production from this change.
