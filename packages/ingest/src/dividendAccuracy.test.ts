import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CASH_PER_10_TOLERANCE,
  applyCninfoPriority,
  breaksToCsv,
  cashPer10Close,
  diffParserEvents,
  dividendEventKey,
  eastmoneyDividendByCodeUrl,
  eastmoneyRawRows,
  goldenDividends,
  goldenEastmoneyRaw,
  missedEventFixture,
  pairCninfo,
  parserDiffReport,
  parserFieldFirst,
  parserPlanTextOnly,
  reconcileDividendSources,
  reconcileGoldenSample,
  scanMissedEvents,
  selectImplementedDividend,
  type AccuracyEvent,
} from "./index.js";

describe("dividend golden fixtures", () => {
  it("locks 4 codes × 3 implemented events and the cash tolerance", () => {
    const events = goldenDividends();
    expect(CASH_PER_10_TOLERANCE).toBe(0.001);
    expect(events).toHaveLength(12);
    expect(new Set(events.map((event) => event.code))).toEqual(
      new Set(["600036", "601919", "600519", "000001"]),
    );
    expect(events.every((event) => event.assign_progress === "实施分配")).toBe(true);
    const maotai = events.find(
      (event) => event.code === "600519" && event.ex_dividend_date === "2026-06-26",
    );
    expect(maotai).toMatchObject({
      name: "贵州茅台",
      secucode: "600519.SH",
      equity_record_date: "2026-06-25",
      cash_div_pretax_per_10: 280.2423,
      impl_plan_profile: "10派280.2423元(含税)",
    });
    expect(maotai?.sources.sina.cash_div_pretax_per_10).toBe(280.242);
    expect(maotai?.sources.cninfo.cash_div_pretax_per_10).toBe(280.2423);
    expect(maotai?.sources.eastmoney.equity_record_date).toBe("2026-06-25");
    expect(cashPer10Close(280.242, 280.2423)).toBe(true);
    expect(cashPer10Close(280.242, 280.2423, 1e-4)).toBe(false);
  });

  it("round-trips Eastmoney fields through the ingest parser", () => {
    for (const event of goldenDividends()) {
      const parsed = selectImplementedDividend(goldenEastmoneyRaw(event));
      expect(parsed).not.toBeNull();
      expect(parsed).toMatchObject({
        code: event.code,
        name: event.name,
        secucode: event.secucode,
        exDividendDate: event.ex_dividend_date,
        equityRecordDate: event.equity_record_date,
        assignProgress: "实施分配",
        implPlanProfile: event.impl_plan_profile,
      });
      expect(cashPer10Close(Number(parsed?.cashPer10), event.cash_div_pretax_per_10)).toBe(true);
    }
  });

  it("reconciles eastmoney, cninfo, and sina with zero breaks", () => {
    const rows = reconcileGoldenSample();
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.status === "MATCH")).toBe(true);
    expect(rows.every((row) => row.cashAgree === true && row.recordAgree === true)).toBe(true);
    expect(breaksToCsv(rows).trim()).toBe(
      "code,ex_date,status,sources,cash_agree,record_agree,cash_per_10_eastmoney,cash_per_10_sina,cash_per_10_cninfo,record_eastmoney,record_sina,record_cninfo",
    );
  });
});

describe("dividend parser regression", () => {
  it("agrees on the 20 captured Eastmoney rows", () => {
    const rows = eastmoneyRawRows();
    expect(rows).toHaveLength(20);
    const report = parserDiffReport(rows);
    expect(report.compared).toBe(20);
    expect(report.disagreements).toEqual([]);
    const first = rows[0];
    expect(first).toBeDefined();
    if (!first) return;
    const parsed = selectImplementedDividend(first);
    const fieldFirst = parserFieldFirst(first);
    expect(parsed?.exDividendDate).toBe(fieldFirst.exDate);
    expect(cashPer10Close(Number(parsed?.cashPer10), fieldFirst.cashPer10)).toBe(true);
  });

  it("fails the build when field cash and plan text disagree", () => {
    const raw = {
      SECURITY_CODE: "600036",
      PRETAX_BONUS_RMB: 1,
      EX_DIVIDEND_DATE: "2026-07-10 00:00:00",
      EQUITY_RECORD_DATE: "2026-07-09 00:00:00",
      NOTICE_DATE: "2026-07-01 00:00:00",
      ASSIGN_PROGRESS: "实施分配",
      IMPL_PLAN_PROFILE: "10派9.99元(含税)",
    };
    const diffs = diffParserEvents(parserFieldFirst(raw), parserPlanTextOnly(raw));
    expect(diffs.cashPer10).toEqual({ a: 1, b: 9.99 });
    expect(parserDiffReport([raw]).disagreements).toHaveLength(1);
  });

  it("hashes the same normalized row to one event_key", async () => {
    const raw = eastmoneyRawRows()[0];
    expect(raw).toBeDefined();
    if (!raw) return;
    const first = selectImplementedDividend(raw);
    const second = selectImplementedDividend({ ...raw });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;
    expect(await dividendEventKey(first)).toBe(await dividendEventKey(second));
    expect(await dividendEventKey({ ...first, implPlanProfile: "10派1元(含税)" })).not.toBe(
      await dividendEventKey(first),
    );
  });
});

describe("dividend reconcile breaks and missed events", () => {
  it("emits a cash break when cninfo disagrees and a secondary break for sina", () => {
    const eastmoney: AccuracyEvent = {
      source: "eastmoney",
      code: "600036",
      name: "招商银行",
      noticeDate: null,
      exDate: "2026-07-10",
      recordDate: "2026-07-09",
      payDate: null,
      cashPer10: 10.03,
      bonusPer10: null,
      transferPer10: null,
      progress: "实施分配",
      planText: "10派10.03元(含税)",
    };
    const cninfo = { ...eastmoney, source: "cninfo", cashPer10: 10.5 };
    const sina = { ...eastmoney, source: "sina", cashPer10: 10.03 };
    const broken = reconcileDividendSources(
      { eastmoney: [eastmoney], cninfo: [cninfo], sina: [sina] },
      ["600036"],
      3,
    );
    expect(broken[0]?.status).toBe("CASH_MISMATCH");
    expect(breaksToCsv(broken)).toContain("CASH_MISMATCH");
    const secondary = reconcileDividendSources(
      {
        eastmoney: [eastmoney],
        cninfo: [{ ...cninfo, cashPer10: 10.03 }],
        sina: [{ ...sina, cashPer10: 11 }],
      },
      ["600036"],
      3,
    );
    expect(secondary[0]?.status).toBe("SECONDARY_MISMATCH");
    const record = reconcileDividendSources(
      {
        eastmoney: [eastmoney],
        cninfo: [{ ...cninfo, cashPer10: 10.03, recordDate: "2026-07-08" }],
        sina: [sina],
      },
      ["600036"],
      3,
    );
    expect(record[0]?.status).toBe("RECORD_MISMATCH");
  });

  it("reports source rows missing from the dividend_events stand-in", () => {
    const fixture = missedEventFixture();
    expect(scanMissedEvents(fixture.source, fixture.dividendEvents)).toEqual(
      fixture.expectedMissing,
    );
    expect(
      scanMissedEvents(fixture.source, [...fixture.dividendEvents, ...fixture.source]),
    ).toEqual([]);
  });

  it("lets cninfo override cash, pay, and ex while keeping both plan texts", () => {
    const kept = applyCninfoPriority(
      "600036",
      {
        exDate: "2026-07-10",
        recordDate: "2026-07-09",
        payDate: null,
        cashPer10: 10.03,
        planText: "10派10.03元(含税)",
      },
      {
        exDate: "2026-07-10",
        recordDate: "2026-07-09",
        payDate: "2026-07-15",
        cashPer10: 10.0304,
        planText: "10派10.0304元(含税)",
      },
    );
    expect(kept.overridden).toEqual(["pay_cash_date"]);
    expect(kept.cashSource).toBe("eastmoney");
    expect(kept.payCashDate).toBe("2026-07-15");
    expect(kept.audit.impl_plan_profile_em).toBe("10派10.03元(含税)");
    expect(kept.audit.impl_plan_profile_cninfo).toContain("10.0304");

    const replaced = applyCninfoPriority(
      "600036",
      {
        exDate: "2026-07-10",
        recordDate: "2026-07-09",
        payDate: null,
        cashPer10: 10,
        planText: "10派10.00元(含税)",
      },
      {
        exDate: "2026-07-11",
        recordDate: "2026-07-09",
        payDate: "2026-07-15",
        cashPer10: 10.5,
        planText: "10派10.50元(含税)",
      },
    );
    expect(replaced.overridden).toEqual([
      "cash_div_pretax_per_10",
      "ex_dividend_date",
      "pay_cash_date",
    ]);
    expect(replaced.cashDivPretaxPer10).toBe(10.5);
    expect(replaced.exDividendDate).toBe("2026-07-11");
    expect(replaced.locateExDate).toBe("2026-07-10");
    expect(replaced.implPlanProfile).toBe("10派10.50元(含税)");
    expect(replaced.audit.cash_div_pretax_per_10_em).toBe(10);
    expect(replaced.audit.impl_plan_profile_em).toBe("10派10.00元(含税)");

    const paired = pairCninfo(
      {
        source: "eastmoney",
        code: "600036",
        name: null,
        noticeDate: null,
        exDate: "2026-07-10",
        recordDate: "2026-07-09",
        payDate: null,
        cashPer10: 10,
        bonusPer10: null,
        transferPer10: null,
        progress: "实施分配",
        planText: null,
      },
      [
        {
          source: "cninfo",
          code: "600036",
          name: null,
          noticeDate: null,
          exDate: "2026-07-11",
          recordDate: "2026-07-09",
          payDate: null,
          cashPer10: 10,
          bonusPer10: null,
          transferPer10: null,
          progress: "实施分配",
          planText: null,
        },
      ],
    );
    expect(paired?.exDate).toBe("2026-07-11");
    expect(eastmoneyDividendByCodeUrl("600519")).toContain(
      "filter=%28SECURITY_CODE%3D%22600519%22%29",
    );
  });
});

describe("accuracy docs", () => {
  it("documents the cash and date tolerances", () => {
    const text = readFileSync("packages/ingest/src/fixtures/dividends/TOLERANCES.md", "utf8");
    expect(text).toContain("±0.001");
    expect(text).toContain("zero");
    expect(text).toContain("DIVIDEND_GOLDEN_LIVE=1");
    expect(text).toContain("pnpm dividends:check");
  });
});
