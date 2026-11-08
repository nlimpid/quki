import { describe, expect, it } from "vitest";

import { ingestDividends } from "./dividendJobs.js";
import type { SqlConn } from "./client.js";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("ingestDividends", () => {
  it("upserts Shanghai names and implemented dividends, skipping Beijing and plans", async () => {
    const calls: { sql: string; params?: unknown[] }[] = [];
    const conn: SqlConn = {
      async execute(sql, params) {
        calls.push({ sql, params });
        if (sql.includes("MAX(notice_date)")) {
          return { rows: [{ notice_date: "2026-06-22 00:00:00" }] };
        }
        return { rows: [] };
      },
    };
    const result = await ingestDividends(conn, "incremental", {
      sleepMs: 0,
      now: new Date("2026-11-08T07:30:00.000Z"),
      fetchImpl: async (url) => {
        if (url.includes("getHQNodeStockCount")) return json(2);
        if (url.includes("getHQNodeData")) {
          return json([
            { symbol: "bj920000", code: "920000", name: "安徽凤凰", trade: "11.240" },
            { symbol: "sh600519", code: "600519", name: "贵州茅台", trade: "1678" },
          ]);
        }
        if (url.includes("RPT_SHAREBONUS_DET")) {
          return json({
            success: true,
            result: {
              pages: 1,
              data: [
                {
                  SECURITY_CODE: "600519",
                  SECUCODE: "600519.SH",
                  SECURITY_NAME_ABBR: "贵州茅台",
                  PRETAX_BONUS_RMB: 280.2423,
                  EX_DIVIDEND_DATE: "2026-06-26 00:00:00",
                  NOTICE_DATE: "2026-06-22 00:00:00",
                  REPORT_DATE: "2025-12-31 00:00:00",
                  ASSIGN_PROGRESS: "实施分配",
                  IMPL_PLAN_PROFILE: "10派280.2423元(含税)",
                  MARKET_TYPE: "069001001001",
                },
                {
                  SECURITY_CODE: "600519",
                  SECUCODE: "600519.SH",
                  PRETAX_BONUS_RMB: null,
                  EX_DIVIDEND_DATE: null,
                  ASSIGN_PROGRESS: "预披露",
                  IMPL_PLAN_PROFILE: "预案",
                  MARKET_TYPE: "069001001001",
                },
                {
                  SECURITY_CODE: "920000",
                  SECUCODE: "920000.BJ",
                  PRETAX_BONUS_RMB: 1,
                  EX_DIVIDEND_DATE: "2026-01-01 00:00:00",
                  ASSIGN_PROGRESS: "实施分配",
                  IMPL_PLAN_PROFILE: "10派1元",
                  MARKET_TYPE: "069001017",
                },
              ],
            },
          });
        }
        throw new Error(`unexpected ${url}`);
      },
    });

    expect(result).toMatchObject({ companies: 1, events: 1, mode: "backfill" });
    const companyInsert = calls.find((call) => call.sql.includes("INSERT INTO companies"));
    expect(companyInsert?.sql).toContain("VALUES(name)");
    expect(companyInsert?.sql).not.toMatch(/\bAS\s+new\b/i);
    expect(JSON.stringify(companyInsert?.params)).toContain("600519");
    expect(JSON.stringify(companyInsert?.params)).not.toContain("920000");
    const dividendInsert = calls.find((call) => call.sql.includes("INSERT INTO dividend_events"));
    expect(dividendInsert?.sql).toContain("VALUES(ex_dividend_date)");
    expect(dividendInsert?.sql).not.toMatch(/\bAS\s+new\b/i);
    const dividendParams = JSON.stringify(dividendInsert?.params);
    expect(dividendParams).toContain("600519.SH");
    expect(dividendParams).toContain("实施分配");
    expect(dividendParams).not.toContain("预披露");
    expect(dividendParams).not.toContain("920000");
    expect(calls.some((call) => call.sql.includes("listing_status = 'delisted'"))).toBe(false);
    expect(calls.some((call) => call.params?.includes("notice:2026-06-22"))).toBe(true);
    const quality = calls.find((call) => call.sql.includes("INSERT INTO crawl_runs"));
    expect(quality?.sql).toContain("request_meta");
    const meta = quality?.params?.find(
      (value) => typeof value === "string" && value.includes("invariantFailures"),
    );
    expect(meta).toContain('"invariantFailures":0');
  });

  it("skips a row that breaks an invariant and still upserts the valid one", async () => {
    const calls: { sql: string; params?: unknown[] }[] = [];
    const conn: SqlConn = {
      async execute(sql, params) {
        calls.push({ sql, params });
        if (sql.includes("MAX(notice_date)")) {
          return { rows: [{ notice_date: "2026-06-22 00:00:00" }] };
        }
        return { rows: [] };
      },
    };
    const result = await ingestDividends(conn, "incremental", {
      sleepMs: 0,
      now: new Date("2026-11-08T07:30:00.000Z"),
      fetchImpl: async (url) => {
        if (url.includes("getHQNodeStockCount")) return json(1);
        if (url.includes("getHQNodeData")) {
          return json([{ symbol: "sh600519", code: "600519", name: "贵州茅台", trade: "1678" }]);
        }
        if (url.includes("RPT_SHAREBONUS_DET")) {
          return json({
            success: true,
            result: {
              pages: 1,
              data: [
                {
                  SECURITY_CODE: "600519",
                  SECUCODE: "600519.SH",
                  SECURITY_NAME_ABBR: "贵州茅台",
                  PRETAX_BONUS_RMB: 280.2423,
                  EX_DIVIDEND_DATE: "2026-06-26 00:00:00",
                  EQUITY_RECORD_DATE: "2026-06-25 00:00:00",
                  NOTICE_DATE: "2026-06-22 00:00:00",
                  ASSIGN_PROGRESS: "实施分配",
                  IMPL_PLAN_PROFILE: "10派280.2423元(含税)",
                  MARKET_TYPE: "069001001001",
                },
                {
                  SECURITY_CODE: "600036",
                  SECUCODE: "600036.SH",
                  SECURITY_NAME_ABBR: "招商银行",
                  PRETAX_BONUS_RMB: 1,
                  EX_DIVIDEND_DATE: "2026-07-01 00:00:00",
                  EQUITY_RECORD_DATE: "2026-07-02 00:00:00",
                  NOTICE_DATE: "2026-06-20 00:00:00",
                  ASSIGN_PROGRESS: "实施分配",
                  IMPL_PLAN_PROFILE: "10派1.00元(含税)",
                  MARKET_TYPE: "069001001001",
                },
              ],
            },
          });
        }
        throw new Error(`unexpected ${url}`);
      },
    });
    expect(result.events).toBe(1);
    const dividendInsert = calls.find((call) => call.sql.includes("INSERT INTO dividend_events"));
    const dividendParams = JSON.stringify(dividendInsert?.params);
    expect(dividendParams).toContain("600519.SH");
    expect(dividendParams).not.toContain("2026-07-01");
    const quality = calls.find((call) => call.sql.includes("INSERT INTO crawl_runs"));
    const meta = quality?.params?.find(
      (value) => typeof value === "string" && value.includes("invariantFailures"),
    );
    expect(meta).toContain('"invariantFailures":1');
    expect(meta).toContain("ex_after_or_on_record");
  });
});
