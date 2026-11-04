import { describe, expect, it } from "vitest";

import { mapCsindexRows } from "./csindex.js";
import { parseSeedCsv } from "./csv.js";
import { dedupeBars, dropClonedBaseRows, dropPhantomStartRow } from "./dedupe.js";

describe("seed csv and dedupe", () => {
  it("keeps null OHLC and parses the H30269 reference close", () => {
    const rows = parseSeedCsv(
      "date,open,high,low,close,volume,amount\n2026-06-29,10134.83,10231.18,9954.70,10204.61,10,1.5\n2017-01-03,,,,8000,1,0.1\n",
    );
    expect(rows[0]?.close).toBe("10204.61");
    expect(rows[1]?.open).toBeNull();
    expect(rows[1]?.low).toBeNull();
  });

  it("dedupes on date and prefers the row with OHLC", () => {
    const rows = dedupeBars([
      {
        date: "2024-01-02",
        open: null,
        high: null,
        low: null,
        close: "1",
        volume: "0",
        amount: "0",
      },
      {
        date: "2024-01-02",
        open: "1",
        high: "2",
        low: "0.5",
        close: "1.5",
        volume: "3",
        amount: "1",
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.open).toBe("1");
  });

  it("drops the 1999-12-31 clone of 2005-01-04", () => {
    const row = {
      date: "2005-01-04",
      open: "713.01",
      high: "713.01",
      low: "703.95",
      close: "705.24",
      volume: "1",
      amount: "67.07",
    };
    const bars = dropClonedBaseRows([
      { ...row, date: "1999-12-31" },
      row,
      { ...row, date: "2005-01-05", close: "710" },
    ]);
    expect(bars.map((bar) => bar.date)).toEqual(["2005-01-04", "2005-01-05"]);
  });

  it("drops a phantom start clone and keeps a stored start date", () => {
    const bars = [
      { date: "2026-01-01", open: "1", high: "1", low: "1", close: "1", volume: "9", amount: "1" },
      { date: "2026-01-02", open: "1", high: "1", low: "1", close: "1", volume: "9", amount: "1" },
    ];
    expect(dropPhantomStartRow(bars, "2026-01-01", false)).toHaveLength(1);
    expect(dropPhantomStartRow(bars, "2026-01-01", true)).toHaveLength(2);
  });
});

describe("csindex mapper", () => {
  it("maps tradeDate and leaves null OHLC", () => {
    const bars = mapCsindexRows([
      {
        tradeDate: "20260629",
        open: 10134.83,
        high: 10231.18,
        low: 9954.7,
        close: 10204.61,
        tradingVol: 100,
        tradingValue: 1.25,
        change: 52.51,
        changePct: 0.52,
      },
      {
        tradeDate: "20170601",
        open: null,
        high: null,
        low: null,
        close: 8000,
        tradingVol: 1,
        tradingValue: 0,
      },
    ]);
    expect(bars[0]?.date).toBe("2026-06-29");
    expect(bars[0]?.close).toBe("10204.610000");
    expect(bars[0]?.amount).toBe("1.2500");
    expect(bars[1]?.open).toBeNull();
  });
});
