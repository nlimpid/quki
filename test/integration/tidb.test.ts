// Guards the fullResult regression: a driver that returns a bare row array
// made every rowsOf() query look empty. Runs against TIDB_CI_DATABASE_URL.
import { alignCloses, buildOverview, buildRotationView, computeRotation } from "@quki/analytics";
import {
  applyMigrations,
  connectTiDb,
  instrumentId,
  listInstrumentIds,
  loadDailyBars,
  numOrNull,
  readMigrationFiles,
  recomputeAnalytics,
  recomputeStoredPairs,
  rowsOf,
  upsertBars,
  type SqlConn,
} from "@quki/db";
import type { SeedBar } from "@quki/ingest";
import { findInstrument, findRotationPair, SEEDED_INSTRUMENTS } from "@quki/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import worker, { type Env } from "../../workers/site/src/index.js";

const CI_URL = process.env.TIDB_CI_DATABASE_URL?.trim() ?? "";
const SESSIONS = 120;
const REPLACED_CLOSE = 4242.5;

if (!CI_URL) {
  console.error(
    "NOTICE: TIDB_CI_DATABASE_URL is not set. Skipping live TiDB integration tests. Create a separate database such as quki_ci and export its connection string to run them.",
  );
}

/** Database path of a mysql:// URL. Empty when the URL has no database. */
function databaseNameFromUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.replace(/^mysql:/i, "http:"));
  } catch {
    throw new Error("TIDB_CI_DATABASE_URL is not a valid mysql URL");
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\/+|\/+$/g, "")).split("/")[0] ?? "";
  return name;
}

/** Refuse to reset production or a system schema. Returns the database name. */
function assertSeparateCiDatabase(raw: string): string {
  const name = databaseNameFromUrl(raw);
  const folded = name.toLowerCase();
  if (folded === "quki") {
    throw new Error(
      'Refusing to reset database "quki". TIDB_CI_DATABASE_URL must point at a separate database such as quki_ci.',
    );
  }
  if (
    name.length === 0 ||
    folded === "mysql" ||
    folded === "information_schema" ||
    folded === "performance_schema" ||
    folded === "sys"
  ) {
    throw new Error(`Refusing to reset database "${name || "(missing)"}".`);
  }
  return name;
}

function fridayOnOrAfter(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const day = date.getUTCDay();
  const delta = day <= 5 ? 5 - day : 6;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weeklyFridays(count: number): string[] {
  const start = fridayOnOrAfter("2024-01-05");
  return Array.from({ length: count }, (_, index) => addDays(start, index * 7));
}

function fixture(base: number, dates: readonly string[]): SeedBar[] {
  return dates.map((date, index) => {
    const close = base + index * 2.5;
    return {
      date,
      open: (close - 1).toFixed(4),
      high: (close + 2).toFixed(4),
      low: (close - 3).toFixed(4),
      close: close.toFixed(4),
      volume: "1000000",
      amount: "1.2500",
    };
  });
}

const RESET_TABLES = [
  "schema_migrations",
  "crawl_watermarks",
  "crawl_runs",
  "backtest_equity",
  "backtest_trades",
  "backtest_runs",
  "significant_lows",
  "analytics_series",
  "bars",
  "instruments",
] as const;

async function resetSchema(conn: SqlConn): Promise<void> {
  await conn.execute("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of RESET_TABLES) {
    await conn.execute(`DROP TABLE IF EXISTS \`${table}\``);
  }
  await conn.execute("SET FOREIGN_KEY_CHECKS = 1");
}

async function closeConn(conn: SqlConn | undefined): Promise<void> {
  const closable = conn as { close?: () => Promise<void> } | undefined;
  if (closable?.close) await closable.close();
}

describe("CI database guard", () => {
  it("reads the database path and refuses production", () => {
    expect(databaseNameFromUrl("mysql://user:secret@gateway.example:4000/quki_ci")).toBe("quki_ci");
    expect(
      databaseNameFromUrl("mysql://user:p%40ss@gateway.example:4000/quki_ci?sslaccept=strict"),
    ).toBe("quki_ci");
    expect(assertSeparateCiDatabase("mysql://user:secret@gateway.example:4000/quki_ci")).toBe(
      "quki_ci",
    );
    expect(() => assertSeparateCiDatabase("mysql://user:secret@gateway.example:4000/quki")).toThrow(
      /quki_ci/,
    );
    expect(() => assertSeparateCiDatabase("mysql://user:secret@gateway.example:4000/QUKI")).toThrow(
      /quki_ci/,
    );
    expect(() => assertSeparateCiDatabase("mysql://user:secret@gateway.example:4000/")).toThrow(
      /missing/,
    );
  });

  it("builds 120 distinct Friday sessions", () => {
    const dates = weeklyFridays(SESSIONS);
    expect(dates).toHaveLength(SESSIONS);
    expect(new Set(dates).size).toBe(SESSIONS);
    for (const iso of dates) {
      expect(new Date(`${iso}T00:00:00Z`).getUTCDay()).toBe(5);
    }
  });
});

describe.skipIf(!CI_URL)("live TiDB", () => {
  let conn: SqlConn | undefined;
  let dividendId = "";
  let benchmarkId = "";
  const dates = weeklyFridays(SESSIONS);

  beforeAll(async () => {
    assertSeparateCiDatabase(CI_URL);
    conn = connectTiDb(CI_URL);
    await resetSchema(conn);
    const files = readMigrationFiles();
    const ran = await applyMigrations(conn, files);
    const expectedFiles = files.map((file) => file.filename);
    if (ran.join("\n") !== expectedFiles.join("\n")) {
      throw new Error(
        `migrations applied [${ran.join(", ")}], expected [${expectedFiles.join(", ")}]`,
      );
    }

    const dividend = await instrumentId(conn, "H00922");
    const benchmark = await instrumentId(conn, "H20903");
    if (!dividend || !benchmark) throw new Error("seed instruments H00922 and H20903 are missing");
    dividendId = dividend;
    benchmarkId = benchmark;

    const dividendBars = fixture(3000, dates);
    const benchmarkBars = fixture(1000, dates);
    await upsertBars(conn, dividendId, dividendBars, "D");
    await upsertBars(conn, benchmarkId, benchmarkBars, "D");

    const last = dividendBars[dividendBars.length - 1];
    if (!last) throw new Error("fixture is empty");
    await upsertBars(conn, dividendId, [{ ...last, close: REPLACED_CLOSE.toFixed(4) }], "D");

    const dividendWeeks = await recomputeAnalytics(
      conn,
      dividendId,
      await loadDailyBars(conn, dividendId),
    );
    const benchmarkWeeks = await recomputeAnalytics(
      conn,
      benchmarkId,
      await loadDailyBars(conn, benchmarkId),
    );
    if (dividendWeeks <= 0 || benchmarkWeeks <= 0) {
      throw new Error("recomputeAnalytics wrote no weekly metrics");
    }
    await recomputeStoredPairs(conn, { mode: "full" });
  });

  afterAll(async () => {
    await closeConn(conn);
  });

  it("lists the seeded instruments", async () => {
    if (!conn) throw new Error("no connection");
    const listed = await listInstrumentIds(conn);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.map((row) => row.symbol).sort()).toEqual(
      SEEDED_INSTRUMENTS.map((item) => item.symbol).sort(),
    );
  });

  it("updates an existing bar with ON DUPLICATE KEY UPDATE", async () => {
    if (!conn) throw new Error("no connection");
    const loaded = await loadDailyBars(conn, dividendId);
    expect(loaded).toHaveLength(SESSIONS);
    expect(loaded[loaded.length - 1]?.close).toBeCloseTo(REPLACED_CLOSE, 4);

    const counted = await conn.execute(
      "SELECT COUNT(*) AS n FROM bars WHERE instrument_id = ? AND freq = 'D' AND trade_date = ?",
      [dividendId, dates[dates.length - 1]],
    );
    expect(numOrNull(rowsOf(counted)[0]?.n)).toBe(1);

    const weekly = await conn.execute(
      "SELECT COUNT(*) AS n FROM bars WHERE instrument_id = ? AND freq = 'W'",
      [dividendId],
    );
    expect(numOrNull(rowsOf(weekly)[0]?.n)).toBe(SESSIONS);
  });

  it("builds a non-empty overview from stored daily bars", async () => {
    if (!conn) throw new Error("no connection");
    const instrument = findInstrument("H00922");
    if (!instrument) throw new Error("missing H00922");
    const overview = buildOverview(await loadDailyBars(conn, dividendId), instrument);
    expect(overview).not.toBeNull();
    expect(overview?.lastClose).toBeCloseTo(REPLACED_CLOSE, 4);
    expect(overview?.tiers.length).toBeGreaterThan(0);
  });

  it("builds a non-empty rotation series from stored bars", async () => {
    if (!conn) throw new Error("no connection");
    const pair = findRotationPair("h00922-h20903");
    if (!pair) throw new Error("missing rotation pair h00922-h20903");
    const view = buildRotationView(
      computeRotation(
        alignCloses(await loadDailyBars(conn, dividendId), await loadDailyBars(conn, benchmarkId)),
      ),
      pair,
    );
    expect(view).not.toBeNull();
    expect(view?.points.length).toBeGreaterThan(0);
    expect(view?.latest.r).toEqual(expect.any(Number));
    expect(Number.isFinite(view?.latest.r)).toBe(true);

    const stored = await conn.execute(
      "SELECT COUNT(*) AS n FROM analytics_series WHERE metric = 'rot_r'",
    );
    const row = rowsOf(stored)[0];
    expect(row).toBeTruthy();
    expect(numOrNull(row?.n)).toBeGreaterThan(0);
  });

  it("serves health, instruments, and overview from the site worker", async () => {
    const env: Env = {
      TIDB_QUKI_DATABASE_URL: CI_URL,
      ASSETS: { fetch: async () => new Response("ok", { status: 200 }) },
    };
    const call = (path: string) => worker.fetch(new Request(`https://quki.test${path}`), env);

    const health = await call("/api/health");
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as { ok: boolean; instruments: number };
    expect(healthBody.ok).toBe(true);
    expect(healthBody.instruments).toBeGreaterThan(0);

    const instruments = await call("/api/instruments");
    expect(instruments.status).toBe(200);
    const instrumentsBody = (await instruments.json()) as { instruments: unknown[] };
    expect(instrumentsBody.instruments.length).toBeGreaterThan(0);

    const overview = await call("/api/indices/H00922/overview");
    expect(overview.status).toBe(200);
    const overviewBody = (await overview.json()) as { lastClose: number; tiers: unknown[] };
    expect(overviewBody.lastClose).toBeCloseTo(REPLACED_CLOSE, 4);
    expect(overviewBody.tiers.length).toBeGreaterThan(0);
  });
});
