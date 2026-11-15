import { assessFreshness, type CrawlSuccess, type MarketFreshness } from "@quki/analytics";

import { dateText, numOrNull, rowsOf, type SqlConn } from "./client.js";

export type { MarketFreshness };

const SUCCESS_JOBS = ["crawl_bars_daily", "dividends_events", "cron_incremental"] as const;

function dateTimeIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(text)) {
    const iso = text.replace(" ", "T");
    return iso.endsWith("Z") ? iso : `${iso}Z`;
  }
  return text;
}

export async function readMarketFreshness(
  conn: SqlConn,
  now = new Date(),
): Promise<MarketFreshness> {
  const quotes = rowsOf(
    await conn.execute(
      `SELECT MAX(updated_at) AS updated_at
       FROM companies
       WHERE listing_status = 'listed' AND market IN ('SH', 'SZ')`,
    ),
  )[0];
  const index = rowsOf(
    await conn.execute(
      `SELECT MIN(latest_date) AS index_through,
              SUM(CASE WHEN latest_date IS NULL THEN 1 ELSE 0 END) AS missing,
              COUNT(*) AS symbols
       FROM (
         SELECT MAX(b.trade_date) AS latest_date
         FROM instruments i
         LEFT JOIN bars b ON b.instrument_id = i.id AND b.freq = 'D'
         WHERE i.source = 'csindex' AND i.status = 'active'
         GROUP BY i.id
       ) AS per_index`,
    ),
  )[0];
  const success = rowsOf(
    await conn.execute(
      `SELECT job_name, finished_at
       FROM crawl_runs
       WHERE status = 'success'
         AND finished_at IS NOT NULL
         AND job_name IN (?, ?, ?)
       ORDER BY finished_at DESC
       LIMIT 1`,
      [...SUCCESS_JOBS],
    ),
  )[0];
  const symbols = numOrNull(index?.symbols) ?? 0;
  const missing = numOrNull(index?.missing) ?? 0;
  const finishedAt = dateTimeIso(success?.finished_at);
  const lastSuccess: CrawlSuccess | null =
    success && finishedAt ? { job: String(success.job_name), at: finishedAt } : null;
  return assessFreshness({
    now,
    asOf: dateTimeIso(quotes?.updated_at),
    indexThrough: index?.index_through == null ? null : dateText(index.index_through),
    indexIncomplete: symbols === 0 || missing > 0,
    lastSuccess,
  });
}

export async function recordCronRun(
  conn: SqlConn,
  input: { status: "success" | "failed"; cron: string; error?: string },
): Promise<void> {
  await conn.execute(
    `INSERT INTO crawl_runs (
       job_name, source, instrument_id, freq, status, rows_upserted, cursor_watermark, error_message, finished_at
     ) VALUES ('cron_incremental', 'cron', NULL, 'D', ?, 0, ?, ?, CURRENT_TIMESTAMP(3))`,
    [input.status, input.cron.slice(0, 128), input.error ? input.error.slice(0, 500) : null],
  );
}
