import type { DailyBar } from "@quki/types";
import { describe, expect, it } from "vitest";

import { alignCloses, computeRotation } from "./rotation.js";
import {
  TEMPERATURE_PRICE_STALE_DAYS,
  TEMPERATURE_V1,
  buildSignalRows,
  calendarDaysBetween,
  decideTemperatureWrite,
  quantileTemperature,
  ruleTemperature,
  selectNewTemperatureRows,
  temperatureCandidates,
  zTemperature,
  type TemperaturePoint,
} from "./temperature.js";

function bar(date: string, close: number): DailyBar {
  return { date, open: close, high: close, low: close, close, volume: 1, amount: 1 };
}

function weekdays(start: string, count: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function path(dates: readonly string[], start: number, swing: number): DailyBar[] {
  let price = start;
  return dates.map((date, index) => {
    price = Math.max(1, price * (1 + ((index % swing) - swing / 2) / 900));
    return bar(date, price);
  });
}

function point(date: string, temperature = 50): TemperaturePoint {
  return { date, temperature, pa: 50, pb: 50, spread40: 0, ratio: 1, ma55: 1 };
}

describe("temperature mappings", () => {
  it("locks the walk-forward default", () => {
    expect(TEMPERATURE_V1).toMatchObject({
      study: "dividend_temperature",
      ver: 1,
      mapping: "quantile",
      w: 0.5,
      k: null,
      coldMax: 20,
      hotMin: 80,
      candidateId: "Q-w0.5",
    });
    expect(
      temperatureCandidates().some((candidate) => candidate.id === TEMPERATURE_V1.candidateId),
    ).toBe(true);
  });

  it("keeps the candidate grid small", () => {
    const candidates = temperatureCandidates();
    expect(candidates).toHaveLength(15);
    expect(candidates.filter((candidate) => candidate.mapping === "quantile")).toHaveLength(3);
    expect(candidates.filter((candidate) => candidate.mapping === "zscore")).toHaveLength(9);
    expect(candidates.filter((candidate) => candidate.mapping === "rule")).toHaveLength(3);
  });

  it("rounds the weighted percentile and clamps 0 to 1", () => {
    expect(quantileTemperature(0, 0, 0.5)).toBe(1);
    expect(quantileTemperature(100, 100, 0.7)).toBe(100);
    expect(quantileTemperature(80, 40, 0.5)).toBe(60);
    expect(quantileTemperature(10.2, 10.2, 0.6)).toBe(10);
  });

  it("maps a zero z-score blend to 51", () => {
    expect(zTemperature(0, 0, 0.5, 1)).toBe(51);
    expect(zTemperature(6, 6, 0.5, 1.2)).toBe(100);
    expect(zTemperature(-6, -6, 0.5, 1.2)).toBe(1);
  });

  it("uses the hot corner, the cold corner, and the fixed 0.6 blend", () => {
    const thresholds = { paCold: 20, pbCold: 30, paHot: 80, pbHot: 70 };
    expect(ruleTemperature(80, 70, thresholds)).toBe(85 + Math.floor((80 + 70) / 40));
    expect(ruleTemperature(100, 100, thresholds)).toBe(90);
    expect(ruleTemperature(20, 30, thresholds)).toBe(15 - Math.floor((80 + 70) / 40));
    expect(ruleTemperature(0, 0, thresholds)).toBe(10);
    expect(ruleTemperature(50, 50, thresholds)).toBe(50);
    expect(ruleTemperature(90, 10, thresholds)).toBe(58);
  });
});

describe("temperature write gate", () => {
  it("does not append when the source date has not moved past the watermark", () => {
    expect(
      decideTemperatureWrite({
        latestAlignedDate: "2026-11-03",
        latestPriceDate: "2026-11-03",
        storedThrough: "2026-11-03",
      }),
    ).toEqual({ action: "skip", reason: "unchanged" });
    expect(
      decideTemperatureWrite({
        latestAlignedDate: "2026-11-03",
        latestPriceDate: "2026-11-04",
        storedThrough: "2026-11-03",
      }).action,
    ).toBe("skip");
  });

  it("appends only sessions newer than the watermark", () => {
    const rows = selectNewTemperatureRows(
      [point("2026-11-03"), point("2026-11-04"), point("2026-11-05")],
      "2026-11-04",
      "2026-11-05",
    );
    expect(rows.map((row) => row.date)).toEqual(["2026-11-05"]);
  });

  it("skips a stale price leg and a missing source", () => {
    expect(
      decideTemperatureWrite({
        latestAlignedDate: null,
        latestPriceDate: "2026-11-03",
        storedThrough: null,
      }).reason,
    ).toBe("no_source");
    const aligned = "2026-11-20";
    const price = "2026-11-01";
    expect(calendarDaysBetween(price, aligned)).toBeGreaterThan(TEMPERATURE_PRICE_STALE_DAYS);
    expect(
      decideTemperatureWrite({
        latestAlignedDate: aligned,
        latestPriceDate: price,
        storedThrough: "2026-11-01",
      }),
    ).toEqual({ action: "skip", reason: "stale_price" });
    expect(
      decideTemperatureWrite({
        latestAlignedDate: "2026-11-14",
        latestPriceDate: "2026-11-04",
        storedThrough: null,
      }).action,
    ).toBe("append");
  });
});

describe("signal construction", () => {
  const dates = weekdays("2005-01-03", 800);
  const price = path(dates, 1000, 17);
  const totalReturn = path(dates, 1100, 13);
  const broad = path(dates, 800, 11);

  it("matches the rotation spread percentile and ignores a later price shock", () => {
    const rows = buildSignalRows({
      priceDaily: price,
      totalReturnDaily: totalReturn,
      broadDaily: broad,
    });
    expect(rows.length).toBeGreaterThan(200);
    const byDate = new Map(
      computeRotation(alignCloses(totalReturn, broad)).map((rotationPoint) => [
        rotationPoint.date,
        rotationPoint,
      ]),
    );
    for (const row of rows) {
      const rotationPoint = byDate.get(row.date);
      expect(rotationPoint?.s).toBeCloseTo(row.spread40, 8);
      expect(rotationPoint?.sPercentile).toBeCloseTo(row.pb, 8);
    }

    const cut = dates[650] ?? "";
    const shocked = price.map((row) => (row.date > cut ? { ...row, close: row.close * 4 } : row));
    const after = buildSignalRows({
      priceDaily: shocked,
      totalReturnDaily: totalReturn,
      broadDaily: broad,
    });
    const afterByDate = new Map(after.map((row) => [row.date, row]));
    for (const row of rows) {
      if (row.date > cut) break;
      const other = afterByDate.get(row.date);
      expect(other?.pa).toBeCloseTo(row.pa, 8);
      expect(other?.pb).toBeCloseTo(row.pb, 8);
      expect(other?.zA ?? null).toEqual(row.zA);
      expect(other?.zB ?? null).toEqual(row.zB);
    }
  });

  it("forward-fills the last closed week onto a mid-week session", () => {
    const rows = buildSignalRows({
      priceDaily: price,
      totalReturnDaily: totalReturn,
      broadDaily: broad,
    });
    const wednesday = rows.find((row) => {
      const day = new Date(`${row.date}T00:00:00Z`).getUTCDay();
      return day === 3 && row.weekDate < row.date;
    });
    if (!wednesday) throw new Error("expected a mid-week session");
    const closed = rows.find((row) => row.date === wednesday.weekDate);
    expect(closed?.pa).toBeCloseTo(wednesday.pa, 10);
    expect(closed?.ratio).toBeCloseTo(wednesday.ratio, 10);
    const fridayTime = Date.parse(`${wednesday.date}T00:00:00Z`) + 2 * 86_400_000;
    const fridayIso = new Date(fridayTime).toISOString().slice(0, 10);
    const sameWeekFriday = rows.find((row) => row.date === fridayIso);
    expect((sameWeekFriday?.weekDate ?? wednesday.weekDate) >= wednesday.weekDate).toBe(true);
  });

  it("does not change earlier rows when the history is truncated", () => {
    const full = buildSignalRows({
      priceDaily: price,
      totalReturnDaily: totalReturn,
      broadDaily: broad,
    });
    const cut = dates[600] ?? "";
    const partial = buildSignalRows({
      priceDaily: price.filter((row) => row.date <= cut),
      totalReturnDaily: totalReturn.filter((row) => row.date <= cut),
      broadDaily: broad.filter((row) => row.date <= cut),
    });
    const fullByDate = new Map(full.map((row) => [row.date, row]));
    const cutDate = new Date(`${cut}T00:00:00Z`);
    const weekday = cutDate.getUTCDay() || 7;
    cutDate.setUTCDate(cutDate.getUTCDate() - (weekday - 1));
    const cutMonday = cutDate.toISOString().slice(0, 10);
    const settled = partial.filter((row) => row.date < cutMonday);
    expect(settled.length).toBeGreaterThan(50);
    for (const row of settled) {
      const other = fullByDate.get(row.date);
      expect(other?.pa).toBeCloseTo(row.pa, 8);
      expect(other?.pb).toBeCloseTo(row.pb, 8);
      expect(other?.ma55).toBeCloseTo(row.ma55, 6);
    }
  });
});
