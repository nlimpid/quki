import { portfolioDividendSummary } from "@quki/analytics";
import type { StockListItem } from "@quki/types";
import { describe, expect, it } from "vitest";

import { portfolioPresentation } from "./portfolioView.js";

function quote(code: string, ttm: number | null, price: number | null = 10): StockListItem {
  return {
    code,
    name: `名称${code}`,
    exchange: "SZ",
    board: "main",
    lastClose: price,
    quoteFresh: true,
    trailingYieldPct: price != null && price > 0 && ttm != null ? (ttm / price) * 100 : null,
    ttmCashPerShare: ttm,
    lastCashDivDate: null,
    lastCashPer10: null,
  };
}

describe("account and local holdings share the portfolio basis", () => {
  it("gives the same stock and shares the same dividend figures", () => {
    const rows = [{ code: "000001", shares: 10 }];
    const quotes = [quote("000001", 1.5, 20)];
    const local = portfolioPresentation(rows, quotes);
    const account = portfolioPresentation(
      rows.map((row) => ({ code: row.code, shares: row.shares })),
      quotes,
    );
    expect(account).toEqual(local);
    expect(account.cards[0]?.annual).toBe(15);
    expect(account.summary).toEqual(
      portfolioDividendSummary([
        {
          shares: 10,
          price: 20,
          ttmCashPerShare: 1.5,
          yieldPct: (1.5 / 20) * 100,
        },
      ]),
    );
  });

  it("sums several holdings and leaves a missing dividend null", () => {
    const rows = [
      { code: "000001", shares: 10 },
      { code: "000002", shares: 4 },
    ];
    const quotes = [quote("000001", 2, 10), quote("000002", null, null)];
    const view = portfolioPresentation(rows, quotes);
    expect(view.cards[0]?.annual).toBe(20);
    expect(view.cards[1]?.annual).toBeNull();
    expect(view.cards[1]?.annual).not.toBe(0);
    expect(view.summary.annualCashCny).toBe(20);
    expect(view.summary.count).toBe(2);
  });

  it("does not invent cash while quotes are missing or the read failed", () => {
    const rows = [{ code: "000001", shares: 10 }];
    const loading = portfolioPresentation(rows, []);
    expect(loading.cards[0]?.annual).toBeNull();
    expect(loading.cards[0]?.price).toBeNull();
    expect(loading.summary.annualCashCny).toBeNull();
    const failed = portfolioPresentation(rows, []);
    expect(failed.cards[0]?.annual).not.toBe(0);
  });

  it("recomputes after a share change and drops the previous account's row", () => {
    const quotes = [quote("000001", 3, 10), quote("000002", 1, 10)];
    const before = portfolioPresentation([{ code: "000001", shares: 10 }], quotes);
    const edited = portfolioPresentation([{ code: "000001", shares: 12 }], quotes);
    expect(before.cards[0]?.annual).toBe(30);
    expect(edited.cards[0]?.annual).toBe(36);
    const otherAccount = portfolioPresentation([{ code: "000002", shares: 2 }], quotes);
    expect(otherAccount.cards.map((card) => card.code)).toEqual(["000002"]);
    expect(otherAccount.cards[0]?.annual).toBe(2);
    expect(otherAccount.summary.annualCashCny).toBe(2);
  });
});
