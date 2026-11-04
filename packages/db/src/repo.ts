import {
  canonicalParams,
  computeWeekMetrics,
  findSignificantLows,
  paramsHash,
  toWeeklyBars,
} from "@quki/analytics";
import { formatDecimal, type SeedBar } from "@quki/ingest";
import { SEEDED_INSTRUMENTS, type DailyBar } from "@quki/types";

import { dateText, numOrNull, rowsOf, type SqlConn } from "./client.js";

const UPSERT_CHUNK = 80;

function placeholders(count: number, width: number): string {
  return Array.from(
    { length: count },
    () => `(${Array.from({ length: width }, () => "?").join(", ")})`,
  ).join(",");
}

export async function instrumentId(conn: SqlConn, symbol: string): Promise<string | null> {
  const result = await conn.execute(
    "SELECT id FROM instruments WHERE source = 'csindex' AND symbol = ? LIMIT 1",
    [symbol],
  );
  const row = rowsOf(result)[0];
  if (!row) return null;
  return String(row.id);
}

export async function listInstrumentIds(conn: SqlConn): Promise<{ symbol: string; id: string }[]> {
  const result = await conn.execute(
    "SELECT id, symbol FROM instruments WHERE source = 'csindex' AND status = 'active' ORDER BY symbol",
  );
  return rowsOf(result).map((row) => ({ id: String(row.id), symbol: String(row.symbol) }));
}

export async function upsertBars(
  conn: SqlConn,
  instrumentIdValue: string,
  rows: readonly SeedBar[],
  freq: "D" | "W",
): Promise<number> {
  let written = 0;
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK) {
    const slice = rows.slice(offset, offset + UPSERT_CHUNK);
    const sql = `
      INSERT INTO bars (
        instrument_id, freq, trade_date, open, high, low, close, volume, amount, pre_close, change_pct, source
      ) VALUES ${placeholders(slice.length, 12)}
      ON DUPLICATE KEY UPDATE
        open = VALUES(open),
        high = VALUES(high),
        low = VALUES(low),
        close = VALUES(close),
        volume = VALUES(volume),
        amount = VALUES(amount),
        pre_close = VALUES(pre_close),
        change_pct = VALUES(change_pct),
        source = VALUES(source),
        crawled_at = CURRENT_TIMESTAMP(3),
        updated_at = CURRENT_TIMESTAMP(3)
    `;
    const args: unknown[] = [];
    for (const row of slice) {
      args.push(
        instrumentIdValue,
        freq,
        row.date,
        row.open,
        row.high,
        row.low,
        row.close,
        row.volume,
        row.amount,
        row.preClose ?? null,
        row.changePct ?? null,
        "csindex",
      );
    }
    await conn.execute(sql, args);
    written += slice.length;
  }
  return written;
}

export async function loadDailyBars(conn: SqlConn, instrumentIdValue: string): Promise<DailyBar[]> {
  const result = await conn.execute(
    `SELECT trade_date, open, high, low, close, volume, amount
     FROM bars WHERE instrument_id = ? AND freq = 'D' ORDER BY trade_date ASC`,
    [instrumentIdValue],
  );
  const bars: DailyBar[] = [];
  for (const row of rowsOf(result)) {
    const close = numOrNull(row.close);
    if (close == null) continue;
    bars.push({
      date: dateText(row.trade_date),
      open: numOrNull(row.open),
      high: numOrNull(row.high),
      low: numOrNull(row.low),
      close,
      volume: numOrNull(row.volume),
      amount: numOrNull(row.amount),
    });
  }
  return bars;
}

export async function latestDailyDate(
  conn: SqlConn,
  instrumentIdValue: string,
): Promise<string | null> {
  const result = await conn.execute(
    "SELECT trade_date FROM bars WHERE instrument_id = ? AND freq = 'D' ORDER BY trade_date DESC LIMIT 1",
    [instrumentIdValue],
  );
  const row = rowsOf(result)[0];
  return row ? dateText(row.trade_date) : null;
}

function weeklySeed(daily: readonly DailyBar[]): SeedBar[] {
  return toWeeklyBars(daily).map((week) => ({
    date: week.date,
    open: formatDecimal(week.open, 6),
    high: formatDecimal(week.high, 6),
    low: formatDecimal(week.low, 6),
    close: formatDecimal(week.close, 6) ?? week.close.toString(),
    volume: formatDecimal(week.volume, 4),
    amount: formatDecimal(week.amount, 4),
    preClose: null,
    changePct: null,
  }));
}

export async function recomputeAnalytics(
  conn: SqlConn,
  instrumentIdValue: string,
  daily: readonly DailyBar[],
): Promise<number> {
  const weeks = toWeeklyBars(daily);
  const metrics = computeWeekMetrics(weeks);
  const lows = findSignificantLows(metrics);
  const hash = await paramsHash();
  const params = canonicalParams();
  await conn.execute("DELETE FROM analytics_series WHERE instrument_id = ? AND params_hash = ?", [
    instrumentIdValue,
    hash,
  ]);
  await conn.execute("DELETE FROM significant_lows WHERE instrument_id = ? AND params_hash = ?", [
    instrumentIdValue,
    hash,
  ]);
  await upsertBars(conn, instrumentIdValue, weeklySeed(daily), "W");

  type Analytic = { date: string; metric: string; value: number; extra: string };
  const analyticRows: Analytic[] = [];
  for (const row of metrics) {
    const base = { ma: row.ma, close: row.close, low: row.effectiveLow };
    const entries: [string, number][] = [
      ["ma55", row.ma],
      ["close_ma55_ratio", row.closeRatio],
      ["close_ma55_dev", row.closeRatio - 1],
      ["low_ma55_ratio", row.lowRatio],
      ["close_ma55_dev_pctile", row.percentile / 100],
    ];
    for (const [metric, value] of entries) {
      analyticRows.push({
        date: row.date,
        metric,
        value,
        extra: JSON.stringify({
          ...base,
          percentile: row.percentile,
          possiblyOpen: row.possiblyOpen,
        }),
      });
    }
  }
  for (const low of lows) {
    analyticRows.push({
      date: low.weekEnd,
      metric: "significant_low",
      value: low.ratioPct / 100,
      extra: JSON.stringify({
        confirmed: low.confirmed,
        possiblyOpen: low.possiblyOpen,
        tag: low.tag,
      }),
    });
  }

  for (let offset = 0; offset < analyticRows.length; offset += UPSERT_CHUNK) {
    const slice = analyticRows.slice(offset, offset + UPSERT_CHUNK);
    const tuple = "(?, ?, ?, ?, ?, CAST(? AS JSON), ?, CAST(? AS JSON))";
    const sql = `
      INSERT INTO analytics_series (
        instrument_id, freq, trade_date, metric, params_hash, params, metric_value, extra
      ) VALUES ${Array.from({ length: slice.length }, () => tuple).join(",")}
      ON DUPLICATE KEY UPDATE
        params = VALUES(params),
        metric_value = VALUES(metric_value),
        extra = VALUES(extra),
        computed_at = CURRENT_TIMESTAMP(3),
        updated_at = CURRENT_TIMESTAMP(3)
    `;
    const args: unknown[] = [];
    for (const row of slice) {
      args.push(instrumentIdValue, "W", row.date, row.metric, hash, params, row.value, row.extra);
    }
    await conn.execute(sql, args);
  }

  for (let offset = 0; offset < lows.length; offset += UPSERT_CHUNK) {
    const slice = lows.slice(offset, offset + UPSERT_CHUNK);
    if (slice.length === 0) continue;
    const tuple = "(?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, CAST(? AS JSON))";
    const sql = `
      INSERT INTO significant_lows (
        instrument_id, freq, trade_date, params_hash, params, low_price, close_price, deviation, score, extra
      ) VALUES ${Array.from({ length: slice.length }, () => tuple).join(",")}
      ON DUPLICATE KEY UPDATE
        params = VALUES(params),
        low_price = VALUES(low_price),
        close_price = VALUES(close_price),
        deviation = VALUES(deviation),
        score = VALUES(score),
        extra = VALUES(extra),
        computed_at = CURRENT_TIMESTAMP(3),
        updated_at = CURRENT_TIMESTAMP(3)
    `;
    const args: unknown[] = [];
    for (const low of slice) {
      const metric = metrics.find((row) => row.date === low.weekEnd);
      args.push(
        instrumentIdValue,
        "W",
        low.weekEnd,
        hash,
        params,
        formatDecimal(low.weekLow, 6),
        formatDecimal(metric?.close ?? null, 6),
        low.ratioPct / 100,
        1 - low.ratioPct / 100,
        JSON.stringify({ confirmed: low.confirmed, possiblyOpen: low.possiblyOpen, tag: low.tag }),
      );
    }
    await conn.execute(sql, args);
  }
  return metrics.length;
}

export function seedSymbols(): string[] {
  return SEEDED_INSTRUMENTS.map((item) => item.symbol);
}
