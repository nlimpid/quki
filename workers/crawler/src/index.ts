import {
  DATABASE_URL_ENV,
  applyMigrations,
  connectTiDb,
  ingestAll,
  ingestDividends,
  readMarketFreshness,
  recordCronRun,
  recomputeStoredPairs,
  type DividendCrawlMode,
  type MarketFreshness,
} from "@quki/db";
import { Hono } from "hono";

import alterSql from "../../../db/migrations/0002_bars_nullable_ohlc.sql";
import auditSql from "../../../db/migrations/0005_dividend_audit.sql";
import benchmarkSql from "../../../db/migrations/0003_rotation_benchmarks.sql";
import dividendSql from "../../../db/migrations/0004_dividends.sql";
import initSql from "../../../db/migrations/0001_init.sql";
import { isCatchUpCron, scheduledIngest } from "./schedule.js";

export interface Env {
  TIDB_QUKI_DATABASE_URL?: string;
  INGEST_TOKEN?: string;
}

function authorized(request: Request, env: Env): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : (request.headers.get("x-ingest-token") ?? "");
  const expected = env.INGEST_TOKEN ?? "";
  if (!expected || token.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < token.length; i += 1)
    mismatch |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

function app() {
  return new Hono<{ Bindings: Env }>();
}

const crawler = app();

crawler.get("/health", (c) => c.json({ ok: true, worker: "quki-crawler" }));

crawler.post("/admin/migrate", async (c) => {
  if (!authorized(c.req.raw, c.env)) return c.json({ error: "unauthorized" }, 401);
  if (!c.env.TIDB_QUKI_DATABASE_URL) return c.json({ error: `missing ${DATABASE_URL_ENV}` }, 503);
  const ran = await applyMigrations(connectTiDb(c.env.TIDB_QUKI_DATABASE_URL), [
    { filename: "0001_init.sql", sql: initSql },
    { filename: "0002_bars_nullable_ohlc.sql", sql: alterSql },
    { filename: "0003_rotation_benchmarks.sql", sql: benchmarkSql },
    { filename: "0004_dividends.sql", sql: dividendSql },
    { filename: "0005_dividend_audit.sql", sql: auditSql },
  ]);
  return c.json({ applied: ran });
});

function dividendMode(body: { dividends?: string }): DividendCrawlMode | "skip" {
  if (body.dividends === "skip") return "skip";
  if (body.dividends === "backfill") return "backfill";
  return "incremental";
}

crawler.post("/admin/ingest", async (c) => {
  if (!authorized(c.req.raw, c.env)) return c.json({ error: "unauthorized" }, 401);
  const databaseUrl = c.env.TIDB_QUKI_DATABASE_URL;
  if (!databaseUrl) return c.json({ error: `missing ${DATABASE_URL_ENV}` }, 503);
  const body = await c.req
    .json()
    .catch(() => ({}) as { mode?: string; symbols?: string[]; dividends?: string });
  const mode = body.mode === "backfill" ? "backfill" : "incremental";
  await ingestAll(connectTiDb(databaseUrl), mode, body.symbols, { rotation: "skip" });
  const dividends = dividendMode(body);
  c.executionCtx.waitUntil(
    recomputeStoredPairs(connectTiDb(databaseUrl), { mode: "incremental" }).catch(
      (error: unknown) => {
        console.error(
          `rotation recompute failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    ),
  );
  if (dividends !== "skip") {
    c.executionCtx.waitUntil(
      ingestDividends(connectTiDb(databaseUrl), dividends).catch((error: unknown) => {
        console.error(
          `dividend ingest failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }),
    );
  }
  return c.json({ ok: true, mode, dividends });
});

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logEvent(level: "log" | "error", payload: Record<string, unknown>): void {
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else console.log(line);
}

async function safeRecord(
  databaseUrl: string,
  status: "success" | "failed",
  cron: string,
  error?: string,
): Promise<void> {
  try {
    await recordCronRun(connectTiDb(databaseUrl), { status, cron, error });
  } catch (error_) {
    logEvent("error", { message: "cron log failed", cron, error: errorText(error_) });
  }
}

/**
 * Quotes and dividends run first. CSIndex fetches time out, so a stuck index
 * response cannot use the whole cron budget before the company refresh.
 */
async function runIncremental(databaseUrl: string, cron: string): Promise<void> {
  const failures: string[] = [];
  try {
    await ingestDividends(connectTiDb(databaseUrl), "incremental");
  } catch (error) {
    const message = errorText(error);
    failures.push(`dividends: ${message}`);
    logEvent("error", { message: "dividend ingest failed", cron, error: message });
  }
  try {
    const bars = await ingestAll(connectTiDb(databaseUrl), "incremental", undefined, {
      rotation: "incremental",
    });
    for (const symbol of bars.failedSymbols) failures.push(`bars: ${symbol}`);
    failures.push(...bars.failedSteps);
  } catch (error) {
    const message = errorText(error);
    failures.push(`bars: ${message}`);
    logEvent("error", { message: "index ingest failed", cron, error: message });
  }
  if (failures.length > 0) {
    const error = failures.join("; ").slice(0, 500);
    await safeRecord(databaseUrl, "failed", cron, error);
    throw new Error(error);
  }
  await safeRecord(databaseUrl, "success", cron);
}

async function runScheduled(cron: string, env: Env): Promise<void> {
  const databaseUrl = env.TIDB_QUKI_DATABASE_URL;
  if (!databaseUrl) {
    const message = `cron skipped: missing ${DATABASE_URL_ENV}`;
    logEvent("error", { message, cron });
    throw new Error(message);
  }
  if (isCatchUpCron(cron)) {
    let freshness: MarketFreshness | null = null;
    try {
      freshness = await readMarketFreshness(connectTiDb(databaseUrl));
    } catch (error) {
      logEvent("error", { message: "freshness read failed", cron, error: errorText(error) });
    }
    logEvent("log", {
      message: "freshness",
      cron,
      stale: freshness?.stale ?? null,
      expectedSession: freshness?.expectedSession ?? null,
      asOf: freshness?.asOf ?? null,
      indexThrough: freshness?.indexThrough ?? null,
    });
    if (freshness && !scheduledIngest(cron, freshness.stale)) return;
    if (freshness?.stale) {
      logEvent("log", {
        message: "stale trading session; retrying incremental",
        cron,
        expectedSession: freshness.expectedSession,
        asOf: freshness.asOf,
        indexThrough: freshness.indexThrough,
        quotesStale: freshness.quotesStale,
        indexStale: freshness.indexStale,
      });
    }
  }
  await runIncremental(databaseUrl, cron);
}

export default {
  fetch: crawler.fetch,
  async scheduled(
    event: { cron?: string },
    env: Env,
    ctx: { waitUntil: (promise: Promise<unknown>) => void },
  ) {
    const run = runScheduled(event.cron ?? "", env);
    ctx.waitUntil(run);
    await run;
  },
};
