import {
  DATABASE_URL_ENV,
  applyMigrations,
  connectTiDb,
  ingestAll,
  recomputeStoredPairs,
} from "@quki/db";
import { Hono } from "hono";

import alterSql from "../../../db/migrations/0002_bars_nullable_ohlc.sql";
import benchmarkSql from "../../../db/migrations/0003_rotation_benchmarks.sql";
import initSql from "../../../db/migrations/0001_init.sql";

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
  ]);
  return c.json({ applied: ran });
});

crawler.post("/admin/ingest", async (c) => {
  if (!authorized(c.req.raw, c.env)) return c.json({ error: "unauthorized" }, 401);
  const databaseUrl = c.env.TIDB_QUKI_DATABASE_URL;
  if (!databaseUrl) return c.json({ error: `missing ${DATABASE_URL_ENV}` }, 503);
  const body = await c.req.json().catch(() => ({}) as { mode?: string; symbols?: string[] });
  const mode = body.mode === "backfill" ? "backfill" : "incremental";
  await ingestAll(connectTiDb(databaseUrl), mode, body.symbols, { rotation: "skip" });
  c.executionCtx.waitUntil(
    recomputeStoredPairs(connectTiDb(databaseUrl), { mode: "incremental" }).catch(
      (error: unknown) => {
        console.error(
          `rotation recompute failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    ),
  );
  return c.json({ ok: true, mode });
});

async function runCron(env: Env): Promise<void> {
  if (!env.TIDB_QUKI_DATABASE_URL) {
    console.error(`cron skipped: missing ${DATABASE_URL_ENV}`);
    return;
  }
  await ingestAll(connectTiDb(env.TIDB_QUKI_DATABASE_URL), "incremental", undefined, {
    rotation: "incremental",
  });
}

export default {
  fetch: crawler.fetch,
  async scheduled(
    _event: unknown,
    env: Env,
    ctx: { waitUntil: (promise: Promise<unknown>) => void },
  ) {
    ctx.waitUntil(runCron(env));
  },
};
