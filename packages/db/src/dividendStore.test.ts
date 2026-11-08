import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { splitSql } from "./sql.js";
import type { SqlConn } from "./client.js";
import {
  companyUpsertSql,
  dividendUpsertSql,
  listStocks,
  stockListFilter,
  summaryUpsertSql,
  watermarkUpsertSql,
} from "./dividendStore.js";
import {
  parseDividendWatermark,
  resolveDividendCrawl,
  shouldMarkMissingDelisted,
} from "./dividendJobs.js";

function assertValuesUpsert(sql: string): void {
  expect(sql).toContain("ON DUPLICATE KEY UPDATE");
  expect(sql).toContain("VALUES(");
  expect(sql).not.toMatch(/\bAS\s+new\b/i);
}

describe("dividend upsert SQL", () => {
  it("uses VALUES(col) and never the TiDB-unsupported row alias", () => {
    assertValuesUpsert(companyUpsertSql(2));
    assertValuesUpsert(dividendUpsertSql(1));
    assertValuesUpsert(summaryUpsertSql(3));
    assertValuesUpsert(watermarkUpsertSql());
    expect(companyUpsertSql(1)).toContain("VALUES(last_close)");
    expect(dividendUpsertSql(1)).toContain("VALUES(ex_dividend_date)");
    expect(summaryUpsertSql(1)).toContain("VALUES(ttm_cash_per_share)");
    const migration = readFileSync("db/migrations/0004_dividends.sql", "utf8");
    const statements = splitSql(migration);
    expect(
      statements.some((statement) => statement.includes("CREATE TABLE IF NOT EXISTS companies")),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes("CREATE TABLE IF NOT EXISTS dividend_events"),
      ),
    ).toBe(true);
    expect(statements.join("\n")).not.toMatch(/\bAS\s+new\b/i);
  });

  it("hides Beijing and delisted names in the list filter", () => {
    const all = stockListFilter({ market: "ALL", sort: "code" });
    expect(all.where).toContain("listing_status = 'listed'");
    expect(all.where).toContain("market IN ('SH', 'SZ')");
    expect(all.order).toBe("code ASC");
    const beijing = stockListFilter({ market: "BJ" });
    expect(beijing.where).toContain("1 = 0");
    const sh = stockListFilter({ market: "SH", sort: "yield", q: "贵州" });
    expect(sh.args).toEqual(["SH", "%贵州%", "%贵州%"]);
    expect(sh.order).toContain("trailing_yield_pct DESC");
    expect(stockListFilter({ sort: "lastDivDate" }).order).toContain("last_ex_dividend_date DESC");
  });
});

describe("dividend crawl plan", () => {
  it("backfills first, resumes a page cursor, then increments from the notice watermark", () => {
    expect(resolveDividendCrawl("incremental", null)).toEqual({ kind: "backfill", startPage: 1 });
    expect(resolveDividendCrawl("incremental", "backfill:40")).toEqual({
      kind: "backfill",
      startPage: 40,
    });
    expect(resolveDividendCrawl("incremental", "notice:2026-11-01")).toEqual({
      kind: "incremental",
      noticeDate: "2026-11-01",
    });
    expect(resolveDividendCrawl("backfill", "notice:2026-11-01")).toEqual({
      kind: "backfill",
      startPage: 1,
    });
    expect(parseDividendWatermark("nope")).toEqual({ kind: "empty" });
    expect(shouldMarkMissingDelisted(999)).toBe(false);
    expect(shouldMarkMissingDelisted(1000)).toBe(true);
  });
});

describe("dividend read gates", () => {
  it("publishes no trailing yield when quote_fresh is off and keeps ttm cash", async () => {
    const row = {
      code: "000001",
      name: "平安银行",
      market: "SZ",
      exchange_board: "main",
      last_close: "11.2000",
      quote_fresh: 0,
      ttm_cash_per_share: "0.24900000",
      trailing_yield_pct: 2.2,
      last_ex_dividend_date: "2026-09-24",
      last_cash_per_10: "2.490000",
    };
    const connFor = (fresh: number): SqlConn => ({
      async execute(sql) {
        if (sql.includes("COUNT(*)")) return { rows: [{ total: 1 }] };
        if (sql.includes("FROM companies")) return { rows: [{ ...row, quote_fresh: fresh }] };
        if (sql.includes("MAX(updated_at)")) {
          return { rows: [{ updated_at: "2026-11-08 07:30:00" }] };
        }
        return { rows: [] };
      },
    });
    const stale = await listStocks(connFor(0), {});
    expect(stale.items[0]).toMatchObject({
      quoteFresh: false,
      lastClose: 11.2,
      trailingYieldPct: null,
      ttmCashPerShare: 0.249,
    });
    const fresh = await listStocks(connFor(1), {});
    expect(fresh.items[0]?.trailingYieldPct).toBe(2.2);
  });

  it("ships the unapplied audit migration and the read-only SQL checks", () => {
    const migration = readFileSync("db/migrations/0005_dividend_audit.sql", "utf8");
    expect(migration).toContain("NOT APPLIED");
    expect(
      splitSql(migration).some((statement) => statement.includes("impl_plan_profile_cninfo")),
    ).toBe(true);
    const checks = readFileSync("db/checks/dividend_invariants.sql", "utf8");
    expect(checks).toContain("ex_dividend_date < equity_record_date");
    expect(checks).toContain("cash_div_pretax_per_10 < 0");
    expect(checks).toContain("GROUP BY event_key");
    expect(checks).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER)\b/i);
  });
});
