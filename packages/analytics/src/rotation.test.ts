import { readFileSync } from "node:fs";

import { dropClonedBaseRows, parseSeedCsv, seedToDaily } from "@quki/ingest";
import type { DailyBar } from "@quki/types";
import { describe, expect, it } from "vitest";

import { alignCloses, computeRotation, latestSpreadCross } from "./rotation.js";

function closes(symbolDates: [string, number][]): DailyBar[] {
  return symbolDates.map(([date, close]) => ({
    date,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    amount: 1,
  }));
}

describe("rotation prism", () => {
  it("rebases R to 1 and drops sessions that are not on both calendars", () => {
    const aligned = alignCloses(
      closes([
        ["2024-01-02", 2],
        ["2024-01-03", 4],
        ["2024-01-05", 6],
      ]),
      closes([
        ["2024-01-02", 1],
        ["2024-01-04", 9],
        ["2024-01-05", 2],
      ]),
    );
    expect(aligned.map((row) => row.date)).toEqual(["2024-01-02", "2024-01-05"]);
    const points = computeRotation(aligned, { maWindow: 2, spreadWindow: 1, rsiWindow: 1 });
    expect(points[0]?.r).toBeCloseTo(1);
    expect(points[1]?.r).toBeCloseTo(1.5);
    expect(points[1]?.s).toBeCloseTo(2 - 1);
  });

  it("builds Bollinger %B, bandwidth, Wilder RSI, and a zero cross", () => {
    const a: [string, number][] = [];
    const b: [string, number][] = [];
    for (let i = 0; i < 80; i += 1) {
      const date = new Date(Date.UTC(2020, 0, 2 + i));
      const iso = date.toISOString().slice(0, 10);
      const wave = i < 40 ? 100 + i : 140 - (i - 40);
      a.push([iso, wave]);
      b.push([iso, 100]);
    }
    const points = computeRotation(alignCloses(closes(a), closes(b)), {
      maWindow: 20,
      bandSigma: 2,
      spreadWindow: 5,
      rsiWindow: 14,
      extremePercentile: 5,
    });
    const ready = points.find(
      (point) => point.ma != null && point.upper != null && point.lower != null,
    );
    const upper = ready?.upper ?? Number.NaN;
    const lower = ready?.lower ?? Number.NaN;
    const ma = ready?.ma ?? Number.NaN;
    const ratio = ready?.r ?? Number.NaN;
    const pctB = ready?.pctB ?? Number.NaN;
    const bandwidth = ready?.bandwidth ?? Number.NaN;
    expect(upper).toBeGreaterThan(ma);
    expect(lower).toBeLessThan(ma);
    expect(pctB).toBeCloseTo((ratio - lower) / (upper - lower));
    expect(bandwidth).toBeCloseTo((upper - lower) / ma);
    expect(points.some((point) => point.rsi != null && point.rsi > 50)).toBe(true);
    expect(points.some((point) => point.rsi != null && point.rsi < 50)).toBe(true);
    const cross = latestSpreadCross(points);
    expect(cross).not.toBeNull();
    expect(points.filter((point) => point.spreadCross).length).toBeGreaterThan(0);
    const last = points[points.length - 1];
    expect(last?.sPercentile).not.toBeNull();
  });

  it("aligns H00922 with H20903 from 2005-01-04 and stops on the shared last date", () => {
    const load = (name: string) =>
      seedToDaily(dropClonedBaseRows(parseSeedCsv(readFileSync(`data/seed/${name}.csv`, "utf8"))));
    const points = computeRotation(alignCloses(load("H00922"), load("H20903")));
    expect(points[0]?.date).toBe("2005-01-04");
    expect(points[0]?.r).toBeCloseTo(1);
    expect(points[0]?.aRebase).toBeCloseTo(1);
    expect(points[0]?.bRebase).toBeCloseTo(1);
    expect(points.some((point) => point.date === "1999-12-31")).toBe(false);
    expect(points.some((point) => point.date === "2026-11-04")).toBe(false);
    expect(points[points.length - 1]?.date).toBe("2026-11-03");
    expect(points[points.length - 1]?.ma).not.toBeNull();
    expect(points[points.length - 1]?.rsi).not.toBeNull();
  });
});
