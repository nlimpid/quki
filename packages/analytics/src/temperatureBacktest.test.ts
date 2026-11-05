import { describe, expect, it } from "vitest";

import {
  bestCandidateId,
  chooseMapping,
  modalId,
  selectExtremeThresholds,
  spearman,
  summarizeDist,
  walkForwardMasks,
} from "./temperatureBacktest.js";
import { temperatureCandidates, type TemperatureCandidate } from "./temperature.js";
import type { PreparedRow } from "./temperatureBacktest.js";

function row(rel1y: number): PreparedRow {
  return {
    date: "2014-06-02",
    pa: 40,
    pb: 60,
    spread40: 0.01,
    ratio: 1,
    ma55: 1,
    weekDate: "2014-05-30",
    weekSample: 80,
    spreadSample: 400,
    zA: 0,
    zB: 0,
    trClose: 1,
    broadClose: 1,
    abs: { "1M": null, "3M": null, "6M": null, "1Y": rel1y },
    rel: { "1M": null, "3M": null, "6M": null, "1Y": rel1y },
    labelDate: { "1M": null, "3M": null, "6M": null, "1Y": "2015-06-02" },
  };
}

function candidate(id: string): TemperatureCandidate {
  return {
    id,
    mapping: "quantile",
    w: 0.5,
    k: null,
    paCold: null,
    pbCold: null,
    paHot: null,
    pbHot: null,
  };
}

describe("walk-forward selection", () => {
  it("keeps each fold's training labels before the test year", () => {
    const dates: string[] = [];
    const labels: string[] = [];
    for (let year = 2010; year <= 2018; year += 1) {
      for (let day = 1; day <= 250; day += 1) {
        dates.push(
          `${year}-${String(Math.floor((day - 1) / 22) + 1).padStart(2, "0")}-${String(((day - 1) % 22) + 1).padStart(2, "0")}`,
        );
        labels.push(`${year + 1}-06-15`);
      }
    }
    const folds = walkForwardMasks(dates, labels);
    const fold = folds.find((item) => item.testYear === 2016);
    expect(fold).toBeDefined();
    if (!fold) return;
    expect(fold.train.length).toBeGreaterThanOrEqual(400);
    for (const index of fold.train) {
      expect(dates[index]! < "2016-01-01").toBe(true);
      expect(labels[index]! < "2016-01-01").toBe(true);
    }
    for (const index of fold.test) expect(dates[index]!.startsWith("2016")).toBe(true);
    expect(fold.train.some((index) => dates[index]!.startsWith("2015"))).toBe(false);
  });

  it("scores only the index list it is given", () => {
    const early = Array.from({ length: 80 }, (_, index) => row(index / 80));
    const late = Array.from({ length: 80 }, (_, index) => row(1 - index / 80));
    const rows = [...early, ...late];
    const lowWhenReturnHigh = rows.map((_, index) => (index < 80 ? 80 - index : 160 - index));
    const highWhenReturnHigh = rows.map((_, index) => index);
    const pool = [candidate("A"), candidate("B")];
    const temps = new Map<string, number[]>([
      ["A", lowWhenReturnHigh],
      ["B", highWhenReturnHigh],
    ]);
    expect(
      bestCandidateId(
        pool,
        temps,
        rows,
        early.map((_, index) => index),
      )?.id,
    ).toBe("A");
    expect(
      bestCandidateId(
        pool,
        temps,
        rows,
        late.map((_, index) => index + 80),
      )?.id,
    ).toBe("B");
  });

  it("prefers the quantile blend when scores are close", () => {
    expect(chooseMapping({ quantile: 0.1, zscore: 0.11, rule: 0.05 })).toBe("quantile");
    expect(chooseMapping({ quantile: 0.05, zscore: 0.1, rule: 0.04 })).toBe("zscore");
    expect(chooseMapping({ quantile: 0.2, zscore: 0.05, rule: 0.19 })).toBe("quantile");
  });

  it("breaks a modal tie toward the long-window candidate", () => {
    expect(modalId(["Q-w0.5", "Q-w0.7", "Q-w0.5", "Q-w0.7"], "Q-w0.7")).toBe("Q-w0.7");
    expect(modalId(["Q-w0.6", "Q-w0.5", "Q-w0.6"], null)).toBe("Q-w0.6");
  });

  it("keeps 1–10 / 90–100 when the cold and hot separation ties", () => {
    const temps = [5, 5, 5, 95, 95, 95, 50];
    const rel = [0.2, 0.2, 0.2, -0.1, -0.1, -0.1, 0];
    const wide = selectExtremeThresholds(
      temps,
      rel,
      temps.map((_, index) => index),
    );
    expect(wide.coldMax).toBe(10);
    expect(wide.hotMin).toBe(90);
    expect(wide.qualified).toBe(false);
  });

  it("ranks a monotone series and summarizes a bucket", () => {
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 8);
    const dist = summarizeDist([0.1, -0.2, 0.3, 0]);
    expect(dist.n).toBe(4);
    expect(dist.winRate).toBeCloseTo(0.5, 8);
    expect(dist.shortfallRate).toBeCloseTo(0.25, 8);
    expect(dist.median).toBeCloseTo(0.05, 8);
  });

  it("ships only candidates from the declared grid", () => {
    const ids = new Set(temperatureCandidates().map((item) => item.id));
    expect(ids.has("Q-w0.5")).toBe(true);
    expect(ids.has("Z-w0.6-k1.0")).toBe(true);
    expect(ids.has("R-base")).toBe(true);
  });
});
