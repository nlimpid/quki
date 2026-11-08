import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { splitSql } from "./sql.js";
import {
  companyUpsertSql,
  dividendUpsertSql,
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
