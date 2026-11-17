import { describe, expect, it } from "vitest";

import { lineWithGaps, splitPriceSeries } from "./klineModel.js";

const full = {
  time: "2026-01-02",
  open: 10,
  high: 12,
  low: 9,
  close: 11,
  volume: 100,
};
const closeOnly = {
  time: "2026-01-05",
  open: null,
  high: null,
  low: null,
  close: 11.5,
  volume: null,
};

describe("kline series mapping", () => {
  it("keeps real OHLC and does not invent a candle for a close-only bar", () => {
    const split = splitPriceSeries([full, closeOnly]);
    expect(split.candles[0]).toMatchObject({ open: 10, high: 12, low: 9, close: 11 });
    expect(split.candles[1]).toEqual({ time: "2026-01-05" });
    expect(split.closeOnly[0]).toEqual({ time: "2026-01-02" });
    expect(split.closeOnly[1]).toEqual({ time: "2026-01-05", value: 11.5 });
  });

  it("breaks a line where the overlay value is missing", () => {
    expect(lineWithGaps([full, closeOnly], [10, null])).toEqual([
      { time: "2026-01-02", value: 10 },
      { time: "2026-01-05" },
    ]);
  });
});
