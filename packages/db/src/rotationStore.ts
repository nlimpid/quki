import {
  alignCloses,
  canonicalParams,
  computeRotation,
  paramsHash,
  ROTATION_DEFAULTS,
} from "@quki/analytics";
import type { DailyBar } from "@quki/types";
import { ROTATION_PAIRS, resolveRotationPair } from "@quki/types";

import type { SqlConn } from "./client.js";
import { instrumentId, loadDailyBars } from "./repo.js";

const CHUNK = 200;
const TAIL_SESSIONS = 60;
const BOOTSTRAP_SESSIONS = 400;

export function rotationStudyParams(pairId: string, a: string, b: string) {
  return {
    study: "rotation_prism",
    pairId,
    a,
    b,
    ...ROTATION_DEFAULTS,
  };
}

async function latestRotationDate(
  conn: SqlConn,
  instrumentIdValue: string,
  hash: string,
): Promise<string | null> {
  const result = await conn.execute(
    `SELECT trade_date FROM analytics_series
     WHERE instrument_id = ? AND params_hash = ? AND metric = 'rot_r'
     ORDER BY trade_date DESC LIMIT 1`,
    [instrumentIdValue, hash],
  );
  const rows =
    result && typeof result === "object" && "rows" in result
      ? (result as { rows?: unknown }).rows
      : [];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0];
  if (!row || typeof row !== "object" || !("trade_date" in row)) return null;
  const value = (row as { trade_date: unknown }).trade_date;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export async function persistRotation(
  conn: SqlConn,
  instrumentIdValue: string,
  pairId: string,
  symbolA: string,
  symbolB: string,
  barsA: readonly DailyBar[],
  barsB: readonly DailyBar[],
  mode: "full" | "incremental" = "full",
): Promise<number> {
  const points = computeRotation(alignCloses(barsA, barsB));
  const params = canonicalParams(rotationStudyParams(pairId, symbolA, symbolB));
  const hash = await paramsHash(rotationStudyParams(pairId, symbolA, symbolB));
  let writing = points;
  if (mode === "incremental") {
    const latest = await latestRotationDate(conn, instrumentIdValue, hash);
    if (latest) {
      const index = points.findIndex((point) => point.date >= latest);
      const from = Math.max(0, (index === -1 ? points.length : index) - TAIL_SESSIONS);
      writing = points.slice(from);
    } else {
      writing = points.slice(-BOOTSTRAP_SESSIONS);
      console.log(
        `rotation ${pairId}: no stored series, writing last ${writing.length} sessions (full history via pnpm backfill)`,
      );
    }
  } else {
    await conn.execute("DELETE FROM analytics_series WHERE instrument_id = ? AND params_hash = ?", [
      instrumentIdValue,
      hash,
    ]);
  }
  type Row = { date: string; metric: string; value: number; extra: string };
  const rows: Row[] = [];
  for (const point of writing) {
    const common = {
      bandCross: point.bandCross,
      spreadCross: point.spreadCross,
      spreadExtreme: point.spreadExtreme,
      sPercentile: point.sPercentile,
    };
    const metrics: [string, number | null][] = [
      ["rot_r", point.r],
      ["rot_r_ma242", point.ma],
      ["rot_r_upper", point.upper],
      ["rot_r_lower", point.lower],
      ["rot_pct_b", point.pctB],
      ["rot_bandwidth", point.bandwidth],
      ["rot_s", point.s],
      ["rot_s_ma242", point.sMa],
      ["rot_rsi14", point.rsi],
      ["rot_rsi_ma242", point.rsiMa],
    ];
    for (const [metric, value] of metrics) {
      if (value == null) continue;
      rows.push({ date: point.date, metric, value, extra: JSON.stringify(common) });
    }
  }
  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const slice = rows.slice(offset, offset + CHUNK);
    const tuple = "(?, 'D', ?, ?, ?, CAST(? AS JSON), ?, CAST(? AS JSON))";
    const sql = `
      INSERT INTO analytics_series (
        instrument_id, freq, trade_date, metric, params_hash, params, metric_value, extra
      ) VALUES ${slice.map(() => tuple).join(",")}
      AS new
      ON DUPLICATE KEY UPDATE
        params = new.params,
        metric_value = new.metric_value,
        extra = new.extra,
        computed_at = CURRENT_TIMESTAMP(3),
        updated_at = CURRENT_TIMESTAMP(3)
    `;
    const args: unknown[] = [];
    for (const row of slice) {
      args.push(instrumentIdValue, row.date, row.metric, hash, params, row.value, row.extra);
    }
    await conn.execute(sql, args);
  }
  return writing.length;
}

/** Recompute every configured pair whose two legs are already in `bars`. */
export async function recomputeStoredPairs(
  conn: SqlConn,
  options?: { mode?: "full" | "incremental" },
): Promise<void> {
  const mode = options?.mode ?? "full";
  for (const definition of ROTATION_PAIRS) {
    const pair = resolveRotationPair(definition);
    const idA = await instrumentId(conn, pair.a);
    const idB = await instrumentId(conn, pair.b);
    if (!idA || !idB) continue;
    const barsA = await loadDailyBars(conn, idA);
    const barsB = await loadDailyBars(conn, idB);
    if (barsA.length === 0 || barsB.length === 0) continue;
    const days = await persistRotation(conn, idA, pair.id, pair.a, pair.b, barsA, barsB, mode);
    console.log(`rotation ${pair.id} ${mode}: ${days} sessions written`);
  }
}
