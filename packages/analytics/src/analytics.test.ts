import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { findInstrument, type DailyBar } from "@quki/types";
import { parseSeedCsv, seedToDaily } from "@quki/ingest";
import { describe, expect, it } from "vitest";

import { ma55BandStrategy, roundTrips, winRate } from "./backtest.js";
import {
  computeWeekMetrics,
  findSignificantLows,
  percentRankInc,
  simpleMovingAverage,
} from "./metrics.js";
import { buildOverview } from "./overview.js";
import { paramsHash } from "./params.js";
import { isoWeekKey, toWeeklyBars, weekFriday } from "./weekly.js";

function bar(date: string, close: number, low?: number | null, high?: number): DailyBar {
  return {
    date,
    open: high == null && low == null ? null : close,
    high: high ?? (low == null ? null : close),
    low: low === undefined ? close : low,
    close,
    volume: 1,
    amount: 1,
  };
}

describe("weekly bars", () => {
  it("groups Monday–Friday and labels the week by the last session", () => {
    const weeks = toWeeklyBars([
      bar("2026-06-22", 10, 9),
      bar("2026-06-23", 11, 10),
      bar("2026-06-26", 12, 8),
      bar("2026-06-29", 13, 7),
    ]);
    expect(weeks.map((week) => week.date)).toEqual(["2026-06-26", "2026-06-29"]);
    expect(weeks[0]).toMatchObject({
      open: 10,
      high: 12,
      low: 8,
      close: 12,
      effectiveLow: 8,
      possiblyOpen: false,
    });
    expect(weeks[1]?.possiblyOpen).toBe(true);
    expect(weekFriday("2026-06-29")).toBe("2026-07-03");
    expect(isoWeekKey("2026-06-26")).toBe(isoWeekKey("2026-06-22"));
    expect(isoWeekKey("2026-06-29")).not.toBe(isoWeekKey("2026-06-26"));
  });

  it("falls back to close when low is missing", () => {
    const weeks = toWeeklyBars([
      {
        date: "2024-01-02",
        open: null,
        high: null,
        low: null,
        close: 80,
        volume: 0,
        amount: 0,
      },
      {
        date: "2024-01-03",
        open: null,
        high: null,
        low: null,
        close: 70,
        volume: 0,
        amount: 0,
      },
    ]);
    expect(weeks[0]?.closeOnly).toBe(true);
    expect(weeks[0]?.low).toBeNull();
    expect(weeks[0]?.effectiveLow).toBe(70);
  });
});

describe("MA55 and significant lows", () => {
  it("computes a simple moving average", () => {
    expect(simpleMovingAverage([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
  });

  it("flags a local low below 95% and leaves a short tail unconfirmed", () => {
    const weeks = [];
    for (let i = 0; i < 70; i += 1) {
      const date = new Date(Date.UTC(2020, 0, 6 + i * 7));
      const iso = date.toISOString().slice(0, 10);
      const close = i === 60 ? 80 : 100;
      weeks.push({
        date: iso,
        weekFriday: iso,
        open: close,
        high: close,
        low: close,
        close,
        effectiveLow: close,
        effectiveHigh: close,
        volume: 1,
        amount: 1,
        sessions: 5,
        closeOnly: false,
        possiblyOpen: false,
      });
    }
    const metrics = computeWeekMetrics(weeks, 55);
    const lows = findSignificantLows(metrics, 13, 0.95);
    expect(lows.some((low) => low.ratioPct < 95)).toBe(true);
    const valley = lows.find((low) => low.weekLow === 80);
    expect(valley).toBeDefined();
    expect(valley?.confirmed).toBe(false);
  });

  it("does not flag a dip that is not the minimum in the window or is above 95%", () => {
    const weeks = [];
    for (let i = 0; i < 80; i += 1) {
      const date = new Date(Date.UTC(2019, 0, 7 + i * 7));
      const iso = date.toISOString().slice(0, 10);
      const close = i === 60 ? 96 : 100;
      weeks.push({
        date: iso,
        weekFriday: iso,
        open: close,
        high: close,
        low: close,
        close,
        effectiveLow: close,
        effectiveHigh: close,
        volume: 1,
        amount: 1,
        sessions: 5,
        closeOnly: false,
        possiblyOpen: false,
      });
    }
    const metrics = computeWeekMetrics(weeks, 55);
    expect(findSignificantLows(metrics, 13, 0.95)).toHaveLength(0);
  });
});

describe("H30269 reference snapshot through 2026-06-29", () => {
  const instrument = findInstrument("H30269");
  const text = readFileSync(resolve("data/seed/H30269.csv"), "utf8");
  const daily = seedToDaily(parseSeedCsv(text)).filter((row) => row.date <= "2026-06-29");

  it("matches the owner's local run on close, MA55, tiers, and deep lows", () => {
    expect(instrument).toBeDefined();
    const overview = buildOverview(daily, instrument!);
    expect(overview).not.toBeNull();
    if (!overview) return;
    expect(overview.lastClose).toBeCloseTo(10204.61, 2);
    expect(overview.ma55).toBeCloseTo(11303.63, 1);
    expect(overview.ratioPct).toBeCloseTo(90.28, 1);
    const tier = (level: number) => overview.tiers.find((row) => row.tier === level);
    expect(tier(90)?.level).toBeCloseTo(10173, 0);
    expect(tier(85)?.level).toBeCloseTo(9608, 0);

    const byMonth = (prefix: string) => overview.lows.find((low) => low.weekEnd.startsWith(prefix));
    expect(byMonth("2016-01")?.ratioPct).toBeCloseTo(78.6, 1);
    expect(byMonth("2018-10")?.ratioPct).toBeCloseTo(79.7, 1);
    expect(byMonth("2020-03")?.ratioPct).toBeCloseTo(86.2, 1);

    const june = overview.lows.find((low) => low.weekEnd === "2026-06-29");
    expect(june?.ratioPct).toBeCloseTo(88.07, 1);
    expect(june?.confirmed).toBe(false);
    expect(june?.possiblyOpen).toBe(true);
    expect(overview.weekPossiblyOpen).toBe(true);
  });

  it("documents why full-history percentile is not the earlier 8.2% figure", () => {
    const weeks = toWeeklyBars(daily);
    const metrics = computeWeekMetrics(weeks);
    const latest = metrics[metrics.length - 1];
    expect(latest).toBeDefined();
    if (!latest) return;
    // Full sample, strictly-below share. Displays as an integer on the page.
    expect(Math.round(latest.percentile)).toBeGreaterThanOrEqual(12);
    expect(Math.round(latest.percentile)).toBeLessThanOrEqual(14);

    const since2015 = metrics
      .filter((row) => row.date >= "2015-01-01")
      .map((row) => row.closeRatio);
    const rank = percentRankInc(since2015, latest.closeRatio) * 100;
    expect(Number(rank.toFixed(1))).toBe(8.2);
  });
});

describe("params hash and backtest hook", () => {
  it("hashes params to 16 hex chars", async () => {
    const hash = await paramsHash();
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(await paramsHash()).toBe(hash);
  });

  it("buys below 90% of MA55 and sells back at 100%", () => {
    const bars = [
      { date: "2024-01-05", close: 100, ma: 100 },
      { date: "2024-01-12", close: 89, ma: 100 },
      { date: "2024-01-19", close: 92, ma: 100 },
      { date: "2024-02-02", close: 101, ma: 100 },
    ];
    const trades = ma55BandStrategy.run(bars, { buyRatio: 0.9, sellRatio: 1 });
    expect(trades.map((trade) => trade.side)).toEqual(["buy", "sell"]);
    const trips = roundTrips(trades);
    expect(trips).toHaveLength(1);
    expect(trips[0]?.returnPct).toBeCloseTo(13.483, 2);
    expect(winRate(trips)).toBe(1);
  });
});
