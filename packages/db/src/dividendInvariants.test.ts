import { describe, expect, it } from "vitest";

import { selectImplementedDividend, type NormalizedDividend } from "@quki/ingest";

import { checkDividendInvariants } from "./dividendInvariants.js";

function implemented(overrides: Partial<NormalizedDividend> = {}): NormalizedDividend {
  return {
    secucode: "600519.SH",
    code: "600519",
    name: "贵州茅台",
    reportDate: "2025-12-31",
    planNoticeDate: "2026-04-17",
    noticeDate: "2026-06-22",
    equityRecordDate: "2026-06-25",
    exDividendDate: "2026-06-26",
    assignProgress: "实施分配",
    implPlanProfile: "10派280.2423元(含税)",
    cashPer10: "280.242300",
    cashAfterTaxPer10: null,
    cashPerShare: "28.02423000",
    bonusPer10: null,
    transferPer10: null,
    bonusTransferSumPer10: null,
    marketTypeEm: "069001001001",
    ...overrides,
  };
}

describe("dividend pre-insert invariants", () => {
  it("accepts an implemented cash row and a transfer-only row", () => {
    expect(checkDividendInvariants(implemented())).toEqual([]);
    expect(
      checkDividendInvariants(
        implemented({
          code: "000725",
          secucode: "000725.SZ",
          cashPer10: null,
          cashPerShare: null,
          transferPer10: "2.000000",
          implPlanProfile: "10转2.00",
          exDividendDate: "2011-06-20",
          equityRecordDate: "2011-06-17",
          noticeDate: "2011-06-14",
        }),
      ),
    ).toEqual([]);
    expect(
      checkDividendInvariants(implemented({ equityRecordDate: null, noticeDate: null })),
    ).toEqual([]);
  });

  it("rejects rows that break a single contract and keeps the rest of the job usable", () => {
    const names = (event: NormalizedDividend) =>
      checkDividendInvariants(event).map((failure) => failure.name);
    expect(names(implemented({ exDividendDate: "" }))).toContain("has_ex_date");
    expect(names(implemented({ cashPer10: "-1.000000" }))).toContain("cash_non_negative");
    expect(names(implemented({ bonusPer10: "-0.100000" }))).toContain("bonus_non_negative");
    expect(names(implemented({ transferPer10: "-2.000000" }))).toContain("transfer_non_negative");
    expect(
      names(implemented({ exDividendDate: "2026-06-24", equityRecordDate: "2026-06-25" })),
    ).toContain("ex_after_or_on_record");
    expect(names(implemented({ noticeDate: "2026-06-27" }))).toContain("notice_before_or_on_ex");
    expect(names(implemented({ assignProgress: "预披露" }))).toContain("progress_implemented");
    expect(
      names(implemented({ cashPer10: null, bonusPer10: null, transferPer10: null })),
    ).toContain("nonzero_distribution");
    expect(names(implemented({ implPlanProfile: "10派1.00元(含税)" }))).toContain(
      "plan_text_matches_cash",
    );
    expect(names(implemented({ cashPer10: "0.000000", bonusPer10: "0.000000" }))).toContain(
      "nonzero_distribution",
    );
  });

  it("passes the golden Eastmoney rows the parser keeps", () => {
    const raw = {
      SECURITY_CODE: "000001",
      SECUCODE: "000001.SZ",
      SECURITY_NAME_ABBR: "平安银行",
      PRETAX_BONUS_RMB: 2.49,
      EX_DIVIDEND_DATE: "2026-09-24 00:00:00",
      EQUITY_RECORD_DATE: "2026-09-23 00:00:00",
      ASSIGN_PROGRESS: "实施分配",
      IMPL_PLAN_PROFILE: "10派2.49元(含税,扣税后2.241元)",
    };
    const event = selectImplementedDividend(raw);
    expect(event).not.toBeNull();
    if (!event) return;
    expect(checkDividendInvariants(event)).toEqual([]);
  });
});
