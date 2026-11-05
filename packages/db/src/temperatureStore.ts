import {
  TEMPERATURE_V1,
  canonicalParams,
  decideTemperatureWrite,
  paramsHash,
  selectNewTemperatureRows,
  type TemperaturePoint,
  type TemperatureWriteDecision,
} from "@quki/analytics";

import { dateText, numOrNull, rowsOf, type SqlConn } from "./client.js";

export const TEMPERATURE_METRIC = "temp_v1";
export const TEMPERATURE_BOOTSTRAP_SESSIONS = 400;
const UPSERT_CHUNK = 80;

export function databaseNameFromUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.replace(/^mysql:/i, "http:"));
  } catch {
    return "";
  }
  return decodeURIComponent(parsed.pathname.replace(/^\/+|\/+$/g, "")).split("/")[0] ?? "";
}

/** Backtest summaries must not land in the production database. */
export function assertBacktestDatabase(url: string): void {
  const name = databaseNameFromUrl(url);
  if (name.toLowerCase() === "quki" || name.length === 0) {
    throw new Error(
      `Refusing to write temperature backtest rows to database "${name || "(missing)"}". Use a local or CI database, not production quki.`,
    );
  }
}

export function rowsForTemperatureWrite(input: {
  points: readonly TemperaturePoint[];
  decision: TemperatureWriteDecision;
  storedThrough: string | null;
  latestAlignedDate: string | null;
  mode: "full" | "incremental";
}): TemperaturePoint[] {
  if (input.mode === "full") return [...input.points];
  if (input.decision.action === "skip" || !input.latestAlignedDate) return [];
  const fresh = selectNewTemperatureRows(
    input.points,
    input.storedThrough,
    input.latestAlignedDate,
  );
  if (input.storedThrough == null && fresh.length > TEMPERATURE_BOOTSTRAP_SESSIONS) {
    return fresh.slice(-TEMPERATURE_BOOTSTRAP_SESSIONS);
  }
  return fresh;
}

export function temperatureUpsertSql(rowCount: number): string {
  const tuple = "(?, 'D', ?, ?, ?, CAST(? AS JSON), ?, CAST(? AS JSON))";
  return `
    INSERT INTO analytics_series (
      instrument_id, freq, trade_date, metric, params_hash, params, metric_value, extra
    ) VALUES ${Array.from({ length: rowCount }, () => tuple).join(",")}
    ON DUPLICATE KEY UPDATE
      params = VALUES(params),
      metric_value = VALUES(metric_value),
      extra = VALUES(extra),
      computed_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
  `;
}

function extraObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

export async function loadTemperatureSeries(
  conn: SqlConn,
  instrumentIdValue: string,
  hash: string,
): Promise<TemperaturePoint[]> {
  const result = await conn.execute(
    `SELECT trade_date, metric_value, extra
     FROM analytics_series
     WHERE instrument_id = ? AND freq = 'D' AND metric = ? AND params_hash = ?
     ORDER BY trade_date ASC`,
    [instrumentIdValue, TEMPERATURE_METRIC, hash],
  );
  const points: TemperaturePoint[] = [];
  for (const row of rowsOf(result)) {
    const temperature = numOrNull(row.metric_value);
    const extra = extraObject(row.extra);
    const pa = numOrNull(extra?.pa);
    const pb = numOrNull(extra?.pb);
    const spread40 = numOrNull(extra?.spread40);
    const ratio = numOrNull(extra?.ratio);
    const ma55 = numOrNull(extra?.ma55);
    if (
      temperature == null ||
      pa == null ||
      pb == null ||
      spread40 == null ||
      ratio == null ||
      ma55 == null
    ) {
      continue;
    }
    points.push({
      date: dateText(row.trade_date),
      temperature,
      pa,
      pb,
      spread40,
      ratio,
      ma55,
    });
  }
  return points;
}

async function latestStoredDate(
  conn: SqlConn,
  instrumentIdValue: string,
  hash: string,
): Promise<string | null> {
  const result = await conn.execute(
    `SELECT trade_date FROM analytics_series
     WHERE instrument_id = ? AND freq = 'D' AND metric = ? AND params_hash = ?
     ORDER BY trade_date DESC LIMIT 1`,
    [instrumentIdValue, TEMPERATURE_METRIC, hash],
  );
  const row = rowsOf(result)[0];
  if (!row || row.trade_date == null) return null;
  return dateText(row.trade_date);
}

async function insertTemperatureRows(
  conn: SqlConn,
  instrumentIdValue: string,
  hash: string,
  paramsJson: string,
  broadSymbol: string,
  rows: readonly TemperaturePoint[],
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK) {
    const slice = rows.slice(offset, offset + UPSERT_CHUNK);
    const args: unknown[] = [];
    for (const row of slice) {
      args.push(
        instrumentIdValue,
        row.date,
        TEMPERATURE_METRIC,
        hash,
        paramsJson,
        row.temperature,
        JSON.stringify({
          pa: row.pa,
          pb: row.pb,
          spread40: row.spread40,
          ratio: row.ratio,
          ma55: row.ma55,
          broad: broadSymbol,
          mapping: TEMPERATURE_V1.mapping,
          w: TEMPERATURE_V1.w,
        }),
      );
    }
    await conn.execute(temperatureUpsertSql(slice.length), args);
  }
}

export async function persistTemperature(
  conn: SqlConn,
  input: {
    instrumentId: string;
    params: Record<string, unknown>;
    broadSymbol: string;
    points: readonly TemperaturePoint[];
    latestAlignedDate: string | null;
    latestPriceDate: string | null;
    mode: "full" | "incremental";
  },
): Promise<{
  action: "skip" | "append" | "replace";
  reason: string;
  written: number;
  through: string | null;
}> {
  const hash = await paramsHash(input.params);
  const paramsJson = canonicalParams(input.params);
  if (input.mode === "full") {
    await conn.execute(
      `DELETE FROM analytics_series
       WHERE instrument_id = ? AND freq = 'D' AND metric = ? AND params_hash = ?`,
      [input.instrumentId, TEMPERATURE_METRIC, hash],
    );
    await insertTemperatureRows(
      conn,
      input.instrumentId,
      hash,
      paramsJson,
      input.broadSymbol,
      input.points,
    );
    return {
      action: "replace",
      reason: "replace",
      written: input.points.length,
      through: input.points[input.points.length - 1]?.date ?? null,
    };
  }

  const storedThrough = await latestStoredDate(conn, input.instrumentId, hash);
  const decision = decideTemperatureWrite({
    latestAlignedDate: input.latestAlignedDate,
    latestPriceDate: input.latestPriceDate,
    storedThrough,
  });
  const writing = rowsForTemperatureWrite({
    points: input.points,
    decision,
    storedThrough,
    latestAlignedDate: input.latestAlignedDate,
    mode: "incremental",
  });
  if (writing.length === 0) {
    return { action: "skip", reason: decision.reason, written: 0, through: null };
  }
  await insertTemperatureRows(
    conn,
    input.instrumentId,
    hash,
    paramsJson,
    input.broadSymbol,
    writing,
  );
  return {
    action: "append",
    reason: "append",
    written: writing.length,
    through: writing[writing.length - 1]?.date ?? null,
  };
}

export function temperatureBacktestInsertSql(): string {
  return `
    INSERT INTO backtest_runs (
      name, strategy, params, instrument_ids, freq, start_date, end_date, metrics, status, finished_at
    ) VALUES (
      ?, 'dividend_temperature_v1', CAST(? AS JSON), CAST(? AS JSON), 'D', ?, ?, CAST(? AS JSON), 'done', CURRENT_TIMESTAMP(3)
    )
  `;
}

export async function persistTemperatureBacktest(
  conn: SqlConn,
  databaseUrl: string,
  input: {
    name: string;
    params: unknown;
    instrumentIds: unknown;
    startDate: string;
    endDate: string;
    metrics: unknown;
  },
): Promise<void> {
  assertBacktestDatabase(databaseUrl);
  await conn.execute(temperatureBacktestInsertSql(), [
    input.name,
    JSON.stringify(input.params),
    JSON.stringify(input.instrumentIds),
    input.startDate,
    input.endDate,
    JSON.stringify(input.metrics),
  ]);
}
