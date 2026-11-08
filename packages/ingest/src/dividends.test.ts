import { describe, expect, it } from "vitest";

import {
  dividendEventKey,
  parseAfterTaxPer10,
  parseEastmoneyPage,
  selectImplementedDividend,
  shouldStopIncremental,
} from "./eastmoneyDividends.js";
import {
  boardOf,
  normalizeShortName,
  parseSinaCount,
  parseSinaPage,
  selectListedCompany,
} from "./sinaList.js";

const bjQuote = {
  symbol: "bj920000",
  code: "920000",
  name: "安徽凤凰",
  trade: "11.240",
};

const shQuote = {
  symbol: "sh600519",
  code: "600519",
  name: "贵州茅台",
  trade: "1678",
};

const starQuote = {
  symbol: "sh688981",
  code: "688981",
  name: "中芯国际",
  trade: "0",
};

const implemented = {
  SECURITY_CODE: "600519",
  SECUCODE: "600519.SH",
  SECURITY_NAME_ABBR: "贵州茅台",
  PRETAX_BONUS_RMB: 280.2423,
  BONUS_RATIO: null,
  IT_RATIO: null,
  BONUS_IT_RATIO: null,
  EQUITY_RECORD_DATE: "2026-06-25 00:00:00",
  EX_DIVIDEND_DATE: "2026-06-26 00:00:00",
  NOTICE_DATE: "2026-06-22 00:00:00",
  PLAN_NOTICE_DATE: "2026-04-17 00:00:00",
  REPORT_DATE: "2025-12-31 00:00:00",
  ASSIGN_PROGRESS: "实施分配",
  IMPL_PLAN_PROFILE: "10派280.2423元(含税)",
  MARKET_TYPE: "069001001001",
};

const plan = {
  ...implemented,
  PRETAX_BONUS_RMB: null,
  EX_DIVIDEND_DATE: null,
  EQUITY_RECORD_DATE: null,
  ASSIGN_PROGRESS: "预披露",
  IMPL_PLAN_PROFILE: "分红金额上限不超过公司2026年上半年实现归属于上市公司股东的净利润",
  REPORT_DATE: "2026-06-30 00:00:00",
};

const transfer = {
  SECURITY_CODE: "000725",
  SECUCODE: "000725.SZ",
  SECURITY_NAME_ABBR: "京东方A",
  PRETAX_BONUS_RMB: null,
  BONUS_RATIO: 0,
  IT_RATIO: 2,
  BONUS_IT_RATIO: 2,
  EX_DIVIDEND_DATE: "2011-06-20 00:00:00",
  NOTICE_DATE: "2011-06-14 00:00:00",
  PLAN_NOTICE_DATE: "2011-04-26 00:00:00",
  REPORT_DATE: "2010-12-31 00:00:00",
  EQUITY_RECORD_DATE: "2011-06-17 00:00:00",
  ASSIGN_PROGRESS: "实施分配",
  IMPL_PLAN_PROFILE: "10转2.00",
  MARKET_TYPE: "069001002001",
};

const afterTax = {
  ...implemented,
  SECURITY_CODE: "000001",
  SECUCODE: "000001.SZ",
  IMPL_PLAN_PROFILE: "10派2.49元(含税,扣税后2.241元)",
  PRETAX_BONUS_RMB: 2.49,
};

const beijing = {
  ...implemented,
  SECURITY_CODE: "920000",
  SECUCODE: "920000.BJ",
  MARKET_TYPE: "069001017",
  PRETAX_BONUS_RMB: 1,
};

describe("Sina company list", () => {
  it("parses the count string and a page of quotes", () => {
    expect(parseSinaCount("5578")).toBe(5578);
    expect(parseSinaPage([bjQuote, shQuote])).toHaveLength(2);
    expect(parseSinaPage("null")).toEqual([]);
  });

  it("drops Beijing and keeps Shanghai, Shenzhen boards, and a missing trade", () => {
    expect(selectListedCompany(bjQuote)).toBeNull();
    const sh = selectListedCompany(shQuote);
    expect(sh).toMatchObject({
      code: "600519",
      secucode: "600519.SH",
      market: "SH",
      board: "main",
      name: "贵州茅台",
      quoteFresh: true,
      lastClose: "1678.0000",
    });
    const star = selectListedCompany(starQuote);
    expect(star?.board).toBe("kcb");
    expect(star?.quoteFresh).toBe(false);
    expect(star?.lastClose).toBeNull();
    expect(boardOf("SZ", "300750")).toBe("cyb");
    expect(normalizeShortName("万 科Ａ")).toBe("万科A");
  });
});

describe("Eastmoney dividends", () => {
  it("keeps implemented Shanghai and Shenzhen rows and derives per-share cash", () => {
    const page = parseEastmoneyPage({
      success: true,
      result: { pages: 2, data: [implemented, plan, transfer, afterTax, beijing] },
    });
    expect(page.pages).toBe(2);
    const kept = page.rows.flatMap((row) => {
      const event = selectImplementedDividend(row);
      return event ? [event] : [];
    });
    expect(kept.map((event) => event.code)).toEqual(["600519", "000725", "000001"]);
    expect(kept[0]).toMatchObject({
      exDividendDate: "2026-06-26",
      cashPer10: "280.242300",
      cashPerShare: "28.02423000",
      assignProgress: "实施分配",
    });
    expect(kept[1]).toMatchObject({
      cashPer10: null,
      cashPerShare: null,
      transferPer10: "2.000000",
      bonusTransferSumPer10: "2.000000",
    });
    expect(kept[2]?.cashAfterTaxPer10).toBe("2.241000");
    expect(parseAfterTaxPer10("10派280.2423元(含税)")).toBeNull();
  });

  it("stops an incremental page once its oldest notice is behind the overlap", () => {
    expect(shouldStopIncremental(["2026-11-01", "2026-10-01"], "2026-10-15")).toBe(true);
    expect(shouldStopIncremental(["2026-11-01", null], "2026-10-15")).toBe(false);
    expect(shouldStopIncremental([null, null], "2026-10-15")).toBe(false);
  });

  it("hashes the uniqueness tuple", async () => {
    const row = selectImplementedDividend(implemented);
    expect(row).not.toBeNull();
    if (!row) return;
    const again = selectImplementedDividend(implemented);
    if (!again) throw new Error("missing");
    expect(await dividendEventKey(row)).toBe(await dividendEventKey(again));
    expect(await dividendEventKey({ ...row, implPlanProfile: "10派1元" })).not.toBe(
      await dividendEventKey(row),
    );
  });
});
