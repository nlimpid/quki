import { describe, expect, it } from "vitest";

import { sanitizeHoldings, upsertHolding, removeHolding } from "./holdings.js";
import {
  addCalendarDays,
  addCalendarMonths,
  adjustedCashPerShare,
  portfolioDividendSummary,
  publishedTrailingYield,
  trailingCashYield,
  trailingWindowStart,
  yearsStart,
} from "./dividendYield.js";

const asOf = "2026-11-08";

describe("dividend dates", () => {
  it("shifts calendar months and clamps month ends", () => {
    expect(addCalendarMonths("2026-11-08", -12)).toBe("2025-11-08");
    expect(addCalendarMonths("2024-02-29", -12)).toBe("2023-02-28");
    expect(addCalendarMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(trailingWindowStart(asOf)).toBe("2025-11-08");
    expect(yearsStart(asOf, "10")).toBe("2016-11-08");
    expect(yearsStart(asOf, "5")).toBe("2021-11-08");
    expect(yearsStart(asOf, "MAX")).toBeNull();
  });
});

describe("trailing cash yield", () => {
  it("sums pretax cash inside the inclusive 12-month window and ignores bonus shares", () => {
    const result = trailingCashYield({
      asOf,
      price: 10,
      events: [
        { exDate: "2026-06-01", cashPerShare: 1, bonusPer10: 0, transferPer10: 0 },
        { exDate: "2026-01-01", cashPerShare: 0.5, bonusPer10: 0, transferPer10: 0 },
        { exDate: "2025-11-08", cashPerShare: 0.25, bonusPer10: 0, transferPer10: 0 },
        { exDate: "2025-11-07", cashPerShare: 9, bonusPer10: 0, transferPer10: 0 },
        { exDate: "2026-04-01", cashPerShare: 0, bonusPer10: 10, transferPer10: 0 },
      ],
    });
    // 2026-04-01 10送10 restates earlier cash and adds nothing itself.
    expect(result.ttmCashPerShare).toBeCloseTo(1.375, 8);
    expect(result.yieldPct).toBeCloseTo(13.75, 8);
  });

  it("restates earlier and same-day cash onto the post-bonus share count", () => {
    const mixed = {
      exDate: "2026-03-01",
      cashPerShare: 1,
      bonusPer10: 0,
      transferPer10: 10,
    };
    expect(adjustedCashPerShare(mixed, [mixed])).toBeCloseTo(0.5, 8);
    const laterSplit = trailingCashYield({
      asOf,
      price: 10,
      events: [
        { exDate: "2026-01-15", cashPerShare: 1, bonusPer10: 0, transferPer10: 0 },
        { exDate: "2026-06-01", cashPerShare: 0, bonusPer10: 10, transferPer10: 0 },
      ],
    });
    expect(laterSplit.ttmCashPerShare).toBeCloseTo(0.5, 8);
    expect(laterSplit.yieldPct).toBeCloseTo(5, 8);
    const noPrice = trailingCashYield({
      asOf,
      price: null,
      events: [{ exDate: "2026-06-01", cashPerShare: 0.5, bonusPer10: 0, transferPer10: 0 }],
    });
    expect(noPrice.ttmCashPerShare).toBeCloseTo(0.5, 8);
    expect(noPrice.yieldPct).toBeNull();
  });

  it("closes [asOf-12 calendar months, asOf] on ex_dividend_date and drops a stale quote", () => {
    const start = trailingWindowStart(asOf);
    expect(start).toBe("2025-11-08");
    expect(addCalendarDays(asOf, -365)).toBe(start);
    const closed = trailingCashYield({
      asOf,
      price: 10,
      quoteFresh: true,
      events: [
        { exDate: start, cashPerShare: 1, bonusPer10: 0, transferPer10: 0 },
        { exDate: asOf, cashPerShare: 1, bonusPer10: 0, transferPer10: 0 },
        { exDate: "2025-11-07", cashPerShare: 9, bonusPer10: 0, transferPer10: 0 },
        { exDate: "2026-11-09", cashPerShare: 9, bonusPer10: 0, transferPer10: 0 },
      ],
    });
    expect(closed.ttmCashPerShare).toBeCloseTo(2, 8);
    expect(closed.yieldPct).toBeCloseTo(20, 8);
    const stale = trailingCashYield({
      asOf,
      price: 10,
      quoteFresh: false,
      events: [{ exDate: "2026-06-01", cashPerShare: 1, bonusPer10: 0, transferPer10: 0 }],
    });
    expect(stale.ttmCashPerShare).toBeCloseTo(1, 8);
    expect(stale.yieldPct).toBeNull();
    expect(publishedTrailingYield(12.5, false)).toBeNull();
    expect(publishedTrailingYield(12.5, true)).toBe(12.5);
  });
});

describe("portfolio dividend summary", () => {
  it("weights by market value, including a last-known price", () => {
    const summary = portfolioDividendSummary([
      { shares: 100, price: 10, ttmCashPerShare: 1, yieldPct: 10 },
      { shares: 100, price: 20, ttmCashPerShare: 1, yieldPct: 5 },
    ]);
    expect(summary.weight).toBe("market");
    expect(summary.annualCashCny).toBeCloseTo(200, 8);
    expect(summary.avgYieldPct).toBeCloseTo((200 / 3000) * 100, 8);
  });

  it("falls back to equal weight only when every price is missing", () => {
    const summary = portfolioDividendSummary([
      { shares: 100, price: null, ttmCashPerShare: 1, yieldPct: 10 },
      { shares: 50, price: null, ttmCashPerShare: 2, yieldPct: 30 },
    ]);
    expect(summary.weight).toBe("equal");
    expect(summary.avgYieldPct).toBeCloseTo(20, 8);
    expect(summary.annualCashCny).toBeCloseTo(200, 8);
    const partial = portfolioDividendSummary([
      { shares: 100, price: 10, ttmCashPerShare: 1, yieldPct: 10 },
      { shares: 50, price: null, ttmCashPerShare: 2, yieldPct: 30 },
    ]);
    expect(partial.weight).toBe("partial");
    expect(partial.avgYieldPct).toBeCloseTo(10, 8);
    expect(partial.annualCashCny).toBeCloseTo(200, 8);
  });
});

describe("holdings state", () => {
  it("drops bad rows and replaces shares for a code", () => {
    const clean = sanitizeHoldings({
      version: 1,
      items: [
        { code: "600519", shares: 100, updatedAt: "2026-11-08T00:00:00.000Z" },
        { code: "920000", shares: 1, updatedAt: "x" },
        { code: "000001", shares: 0, updatedAt: "x" },
        { code: "nope", shares: 10, updatedAt: "x" },
      ],
    });
    expect(clean.items.map((item) => item.code)).toEqual(["600519", "920000"]);
    const next = upsertHolding(clean, "000725", 20, "2026-11-08T01:00:00.000Z");
    expect(next.items.map((item) => item.code)).toEqual(["000725", "600519", "920000"]);
    const replaced = upsertHolding(next, "600519", 5, "2026-11-08T02:00:00.000Z");
    expect(replaced.items.find((item) => item.code === "600519")?.shares).toBe(5);
    expect(removeHolding(replaced, "000725").items).toHaveLength(2);
    expect(sanitizeHoldings(null).items).toEqual([]);
  });
});
