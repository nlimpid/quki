import {
  TEMPERATURE_BROADS,
  TEMPERATURE_FAMILIES,
  buildSignalRows,
  lastBarDate,
  latestAlignedSession,
  productionCandidate,
  productionStudyParams,
  temperaturePoints,
} from "@quki/analytics";
import { fetchCsindexDaily } from "@quki/ingest";
import { findInstrument, type TemperatureFamilyId } from "@quki/types";

import type { SqlConn } from "./client.js";
import { recomputeStoredPairs } from "./rotationStore.js";
import { persistTemperature } from "./temperatureStore.js";
import {
  instrumentId,
  latestDailyDate,
  listInstrumentIds,
  loadDailyBars,
  recomputeAnalytics,
  upsertBars,
} from "./repo.js";

function shanghaiToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function recordCrawl(
  conn: SqlConn,
  input: {
    jobName: string;
    symbol: string | null;
    instrumentId: string | null;
    status: "running" | "success" | "partial" | "failed";
    rows: number;
    watermark: string | null;
    error?: string;
  },
): Promise<void> {
  await conn.execute(
    `INSERT INTO crawl_runs (job_name, source, instrument_id, freq, status, rows_upserted, cursor_watermark, error_message, finished_at)
     VALUES (?, 'csindex', ?, 'D', ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [
      input.jobName,
      input.instrumentId,
      input.status,
      input.rows,
      input.watermark,
      input.error ?? null,
    ],
  );
  if (input.status === "success" && input.watermark && input.instrumentId) {
    await conn.execute(
      `INSERT INTO crawl_watermarks (job_name, source, instrument_id, freq, watermark)
       VALUES (?, 'csindex', ?, 'D', ?)
       ON DUPLICATE KEY UPDATE watermark = VALUES(watermark), updated_at = CURRENT_TIMESTAMP(3)`,
      [input.jobName, input.instrumentId, input.watermark],
    );
  }
}

export async function ingestSymbol(
  conn: SqlConn,
  symbol: string,
  mode: "incremental" | "backfill",
): Promise<{ rows: number; through: string | null }> {
  const id = await instrumentId(conn, symbol);
  if (!id) throw new Error(`Instrument ${symbol} is not seeded. Run pnpm migrate first.`);
  const meta = findInstrument(symbol);
  const stored = await latestDailyDate(conn, id);
  const start = mode === "backfill" || !stored ? (meta?.baseDate ?? "2004-12-31") : stored;
  const end = shanghaiToday();
  const bars = await fetchCsindexDaily({
    symbol,
    startDate: start,
    endDate: end,
    startAlreadyStored: stored != null && start === stored,
  });
  const rows = await upsertBars(conn, id, bars, "D");
  const daily = await loadDailyBars(conn, id);
  await recomputeAnalytics(conn, id, daily);
  const through = daily[daily.length - 1]?.date ?? null;
  await recordCrawl(conn, {
    jobName: mode === "backfill" ? "crawl_bars_backfill" : "crawl_bars_daily",
    symbol,
    instrumentId: id,
    status: "success",
    rows,
    watermark: through,
  });
  return { rows, through };
}

export async function ingestAll(
  conn: SqlConn,
  mode: "incremental" | "backfill",
  symbols?: string[],
  options?: { rotation?: "full" | "incremental" | "skip" },
): Promise<{ failedSymbols: string[]; failedSteps: string[] }> {
  const failedSymbols: string[] = [];
  const failedSteps: string[] = [];
  const known = symbols ?? (await listInstrumentIds(conn)).map((row) => row.symbol);
  for (const symbol of known) {
    try {
      const result = await ingestSymbol(conn, symbol, mode);
      console.log(`ingest ${symbol} ${mode}: ${result.rows} rows through ${result.through}`);
    } catch (error) {
      const id = await instrumentId(conn, symbol).catch(() => null);
      const message = error instanceof Error ? error.message : String(error);
      failedSymbols.push(symbol);
      console.error(`ingest ${symbol} failed: ${message}`);
      if (id) {
        await recordCrawl(conn, {
          jobName: "crawl_bars_daily",
          symbol,
          instrumentId: id,
          status: "failed",
          rows: 0,
          watermark: null,
          error: message,
        });
      }
    }
    await sleep(1000);
  }
  const rotation = options?.rotation ?? "full";
  if (rotation !== "skip") {
    try {
      await recomputeStoredPairs(conn, {
        mode: rotation === "incremental" ? "incremental" : "full",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedSteps.push(`rotation: ${message}`);
      console.error(`rotation recompute failed: ${message}`);
    }
  }
  const temperatureMode = rotation === "full" ? "full" : "incremental";
  try {
    await recomputeTemperature(conn, { mode: temperatureMode });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failedSteps.push(`temperature: ${message}`);
    console.error(`temperature recompute failed: ${message}`);
  }
  return { failedSymbols, failedSteps };
}

export async function recomputeTemperature(
  conn: SqlConn,
  options?: { mode?: "full" | "incremental" },
): Promise<void> {
  const mode = options?.mode ?? "full";
  const families = Object.keys(TEMPERATURE_FAMILIES) as TemperatureFamilyId[];
  for (const family of families) {
    for (const broad of TEMPERATURE_BROADS) {
      const legs = {
        priceSymbol: TEMPERATURE_FAMILIES[family].priceSymbol,
        totalReturnSymbol: TEMPERATURE_FAMILIES[family].totalReturnSymbol,
        broadSymbol: broad,
      };
      const jobName = `compute_temperature:${legs.totalReturnSymbol.toLowerCase()}-${broad.toLowerCase()}`;
      try {
        const priceId = await instrumentId(conn, legs.priceSymbol);
        const totalReturnId = await instrumentId(conn, legs.totalReturnSymbol);
        const broadId = await instrumentId(conn, legs.broadSymbol);
        if (!priceId || !totalReturnId || !broadId) {
          console.log(`temperature ${jobName}: instrument not seeded`);
          continue;
        }
        const price = await loadDailyBars(conn, priceId);
        const totalReturn = await loadDailyBars(conn, totalReturnId);
        const broadBars = await loadDailyBars(conn, broadId);
        if (price.length === 0 || totalReturn.length === 0 || broadBars.length === 0) continue;
        const points = temperaturePoints(
          buildSignalRows({
            priceDaily: price,
            totalReturnDaily: totalReturn,
            broadDaily: broadBars,
          }),
          productionCandidate(),
        );
        const result = await persistTemperature(conn, {
          instrumentId: totalReturnId,
          params: productionStudyParams(legs),
          broadSymbol: broad,
          points,
          latestAlignedDate: latestAlignedSession(totalReturn, broadBars),
          latestPriceDate: lastBarDate(price),
          mode,
        });
        await recordCrawl(conn, {
          jobName,
          symbol: legs.totalReturnSymbol,
          instrumentId: totalReturnId,
          status: "success",
          rows: result.written,
          watermark: result.action === "skip" ? null : result.through,
        });
        console.log(`temperature ${jobName} ${mode}: ${result.action} ${result.written}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`temperature ${jobName} failed: ${message}`);
        const totalReturnId = await instrumentId(conn, legs.totalReturnSymbol).catch(() => null);
        if (totalReturnId) {
          await recordCrawl(conn, {
            jobName,
            symbol: legs.totalReturnSymbol,
            instrumentId: totalReturnId,
            status: "failed",
            rows: 0,
            watermark: null,
            error: message,
          });
        }
      }
    }
  }
}
