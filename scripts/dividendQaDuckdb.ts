/**
 * Local dividend QA. Joins fixture CSVs in an in-memory DuckDB.
 * Production ingest stays on TiDB Serverless and does not import this module.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import {
  CASH_PER_10_TOLERANCE,
  goldenDividends,
  missedEventFixture,
  type MissedEventRef,
  type ReconcileRow,
  type ReconcileStatus,
} from "@quki/ingest";

export const LOCAL_QA_ENGINE = "duckdb" as const;

export type LocalDividendQa = {
  engine: typeof LOCAL_QA_ENGINE;
  reconciled: ReconcileRow[];
  missing: MissedEventRef[];
};

const RECONCILE_SQL = `
  WITH keyed AS (
    SELECT DISTINCT code, ex_dividend_date AS ex_date
    FROM source_events
  ),
  latest AS (
    SELECT code, ex_date
    FROM (
      SELECT
        code,
        ex_date,
        row_number() OVER (PARTITION BY code ORDER BY ex_date DESC) AS rn
      FROM keyed
    )
    WHERE rn <= 3
  ),
  wide AS (
    SELECT
      l.code,
      l.ex_date,
      em.cash_div_pretax_per_10 AS cash_em,
      si.cash_div_pretax_per_10 AS cash_si,
      cn.cash_div_pretax_per_10 AS cash_cn,
      em.equity_record_date AS record_em,
      si.equity_record_date AS record_si,
      cn.equity_record_date AS record_cn,
      em.impl_plan_profile AS plan_em,
      si.impl_plan_profile AS plan_si,
      cn.impl_plan_profile AS plan_cn,
      em.code IS NOT NULL AS has_em,
      si.code IS NOT NULL AS has_si,
      cn.code IS NOT NULL AS has_cn
    FROM latest l
    LEFT JOIN source_events em
      ON em.code = l.code AND em.ex_dividend_date = l.ex_date AND em.source = 'eastmoney'
    LEFT JOIN source_events si
      ON si.code = l.code AND si.ex_dividend_date = l.ex_date AND si.source = 'sina'
    LEFT JOIN source_events cn
      ON cn.code = l.code AND cn.ex_dividend_date = l.ex_date AND cn.source = 'cninfo'
  )
  SELECT
    code,
    strftime(ex_date, '%Y-%m-%d') AS ex_date,
    concat_ws(
      ',',
      CASE WHEN has_em THEN 'eastmoney' END,
      CASE WHEN has_cn THEN 'cninfo' END,
      CASE WHEN has_si THEN 'sina' END
    ) AS sources,
    CASE
      WHEN has_em AND has_cn THEN abs(cash_em - cash_cn) <= ${CASH_PER_10_TOLERANCE}
      ELSE NULL
    END AS cash_agree,
    CASE
      WHEN has_em AND has_cn THEN record_em IS NOT DISTINCT FROM record_cn
      ELSE NULL
    END AS record_agree,
    cash_em,
    cash_si,
    cash_cn,
    strftime(record_em, '%Y-%m-%d') AS record_em,
    strftime(record_si, '%Y-%m-%d') AS record_si,
    strftime(record_cn, '%Y-%m-%d') AS record_cn,
    plan_em,
    plan_si,
    plan_cn,
    CASE
      WHEN (has_em::INTEGER + has_cn::INTEGER + has_si::INTEGER) <= 1 THEN 'SINGLE'
      WHEN NOT has_em OR NOT has_cn THEN 'PARTIAL'
      WHEN cash_em IS NULL OR cash_cn IS NULL OR abs(cash_em - cash_cn) > ${CASH_PER_10_TOLERANCE}
        THEN 'CASH_MISMATCH'
      WHEN record_em IS DISTINCT FROM record_cn THEN 'RECORD_MISMATCH'
      WHEN has_si AND (
        cash_si IS NULL
        OR coalesce(cash_cn, cash_em) IS NULL
        OR abs(coalesce(cash_cn, cash_em) - cash_si) > ${CASH_PER_10_TOLERANCE}
        OR (record_si IS NOT NULL AND record_si IS DISTINCT FROM coalesce(record_cn, record_em))
      ) THEN 'SECONDARY_MISMATCH'
      ELSE 'MATCH'
    END AS status
  FROM wide
  ORDER BY code, ex_date DESC
`;

const MISSED_SQL = `
  SELECT DISTINCT
    s.code,
    strftime(s.ex_dividend_date, '%Y-%m-%d') AS ex_dividend_date
  FROM em_source s
  ANTI JOIN dividend_events d
    ON s.code = d.code AND s.ex_dividend_date = d.ex_dividend_date
  ORDER BY s.code, ex_dividend_date
`;

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  const rendered = String(value);
  if (/[",\n]/.test(rendered)) return `"${rendered.replaceAll('"', '""')}"`;
  return rendered;
}

function goldenSourceCsv(): string {
  const lines = [
    "source,code,name,ex_dividend_date,equity_record_date,cash_div_pretax_per_10,impl_plan_profile",
  ];
  for (const event of goldenDividends()) {
    for (const source of ["eastmoney", "cninfo", "sina"] as const) {
      const fields = event.sources[source];
      lines.push(
        [
          source,
          event.code,
          event.name,
          fields.ex_dividend_date,
          fields.equity_record_date,
          fields.cash_div_pretax_per_10,
          fields.impl_plan_profile,
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function missedCsv(
  rows: readonly { code: string; ex_dividend_date: string; cash?: number | null }[],
): string {
  const lines = ["code,ex_dividend_date,cash_div_pretax_per_10"];
  for (const row of rows) {
    lines.push([row.code, row.ex_dividend_date, row.cash ?? ""].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function query(
  connection: DuckDBConnection,
  sql: string,
  params?: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const reader = params
    ? await connection.runAndReadAll(sql, params)
    : await connection.runAndReadAll(sql);
  return reader.getRowObjectsJson() as Record<string, unknown>[];
}

async function loadCsv(connection: DuckDBConnection, table: string, path: string): Promise<void> {
  await connection.run(
    `CREATE TABLE ${table} AS SELECT * FROM read_csv_auto($path, header = true)`,
    { path },
  );
}

function asText(value: unknown): string | null {
  if (value == null) return null;
  const rendered = String(value);
  return rendered === "" ? null : rendered;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolOrNull(value: unknown): boolean | null {
  if (value == null) return null;
  return value === true || value === 1 || value === "true";
}

function toReconcileRow(row: Record<string, unknown>): ReconcileRow {
  const status = String(row.status ?? "");
  return {
    code: String(row.code ?? ""),
    exDate: String(row.ex_date ?? ""),
    status: status as ReconcileStatus,
    sources: String(row.sources ?? "")
      .split(",")
      .filter((source) => source.length > 0),
    cashBySource: {
      eastmoney: numberOrNull(row.cash_em),
      sina: numberOrNull(row.cash_si),
      cninfo: numberOrNull(row.cash_cn),
    },
    recordBySource: {
      eastmoney: asText(row.record_em),
      sina: asText(row.record_si),
      cninfo: asText(row.record_cn),
    },
    planBySource: {
      eastmoney: asText(row.plan_em),
      sina: asText(row.plan_si),
      cninfo: asText(row.plan_cn),
    },
    cashAgree: boolOrNull(row.cash_agree),
    recordAgree: boolOrNull(row.record_agree),
  };
}

async function withMemory<T>(fn: (connection: DuckDBConnection) => Promise<T>): Promise<T> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    return await fn(connection);
  } finally {
    connection.closeSync();
  }
}

/** Join a source CSV (one row per source and ex-date) and classify breaks in DuckDB. */
export async function reconcileCsvInDuckdb(csv: string): Promise<ReconcileRow[]> {
  const dir = await mkdtemp(join(tmpdir(), "quki-div-"));
  const path = join(dir, "source_events.csv");
  try {
    await writeFile(path, csv, "utf8");
    return await withMemory(async (connection) => {
      await loadCsv(connection, "source_events", path);
      const rows = await query(connection, RECONCILE_SQL);
      return rows.map(toReconcileRow);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Eastmoney implemented list ANTI JOIN the local dividend_events stand-in. */
export async function scanMissedInDuckdb(
  source: readonly MissedEventRef[],
  stored: readonly MissedEventRef[],
): Promise<MissedEventRef[]> {
  const dir = await mkdtemp(join(tmpdir(), "quki-miss-"));
  const sourcePath = join(dir, "em_source.csv");
  const storedPath = join(dir, "dividend_events.csv");
  try {
    await writeFile(sourcePath, missedCsv(source), "utf8");
    await writeFile(storedPath, missedCsv(stored), "utf8");
    return await withMemory(async (connection) => {
      await loadCsv(connection, "em_source", sourcePath);
      await loadCsv(connection, "dividend_events", storedPath);
      const rows = await query(connection, MISSED_SQL);
      return rows.map((row) => ({
        code: String(row.code ?? ""),
        ex_dividend_date: String(row.ex_dividend_date ?? ""),
      }));
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Golden fixture plus the missed-event fixture, both joined in DuckDB. */
export async function runLocalDividendQa(): Promise<LocalDividendQa> {
  const missed = missedEventFixture();
  const [reconciled, missing] = await Promise.all([
    reconcileCsvInDuckdb(goldenSourceCsv()),
    scanMissedInDuckdb(missed.source, missed.dividendEvents),
  ]);
  return { engine: LOCAL_QA_ENGINE, reconciled, missing };
}
