import {
  DERIVED_TIER_LEVELS,
  TIER_LABELS,
  TIER_LEVELS,
  type LowRow,
  type LowTag,
  type TierLevel,
  type TierRow,
} from "@quki/types";

import { MA55_PARAMS } from "./params.js";
import type { WeeklyBar } from "./weekly.js";

export type WeekMetric = {
  date: string;
  close: number;
  effectiveLow: number;
  ma: number;
  closeRatio: number;
  lowRatio: number;
  /** 0–100. Share of ratios through this week that are strictly below it. */
  percentile: number;
  possiblyOpen: boolean;
};

export function simpleMovingAverage(values: readonly number[], window: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i] ?? 0;
    if (i >= window) sum -= values[i - window] ?? 0;
    out.push(i >= window - 1 ? sum / window : null);
  }
  return out;
}

/**
 * Percent of observations in `ratios[0..index]` that are strictly below
 * `ratios[index]`. The current point is in the denominator, so the reading
 * means "higher than n% of the sample, including itself as not-below".
 */
export function percentileStrictlyBelow(ratios: readonly number[], index: number): number {
  const current = ratios[index];
  if (current == null || index < 0) return 0;
  let below = 0;
  const sample = index + 1;
  for (let i = 0; i <= index; i += 1) {
    const value = ratios[i];
    if (value != null && value < current) below += 1;
  }
  return (below / sample) * 100;
}

/**
 * Excel PERCENTRANK.INC style: count(values < x) / (n - 1).
 * Used only to explain the owner's earlier 8.2% figure on a 2015+ subsample.
 */
export function percentRankInc(values: readonly number[], x: number): number {
  if (values.length < 2) return 0;
  let below = 0;
  for (const value of values) if (value < x) below += 1;
  return below / (values.length - 1);
}

export function computeWeekMetrics(
  weeks: readonly WeeklyBar[],
  window = MA55_PARAMS.window,
): WeekMetric[] {
  const closes = weeks.map((week) => week.close);
  const ma = simpleMovingAverage(closes, window);
  const metrics: WeekMetric[] = [];
  const ratios: number[] = [];
  for (let i = 0; i < weeks.length; i += 1) {
    const week = weeks[i];
    const average = ma[i];
    if (!week || average == null || average === 0) continue;
    const closeRatio = week.close / average;
    ratios.push(closeRatio);
    metrics.push({
      date: week.date,
      close: week.close,
      effectiveLow: week.effectiveLow,
      ma: average,
      closeRatio,
      lowRatio: week.effectiveLow / average,
      percentile: 0,
      possiblyOpen: week.possiblyOpen,
    });
  }
  for (let i = 0; i < metrics.length; i += 1) {
    const row = metrics[i];
    if (!row) continue;
    row.percentile = percentileStrictlyBelow(ratios, i);
  }
  return metrics;
}

/**
 * Full-history tier stats from weekly close/MA55.
 * Tiers under 100 count consecutive weeks below the tier.
 * Tiers over 100 count consecutive weeks above it.
 * 100% counts consecutive weeks below the moving average.
 */
export function tierRows(metrics: readonly WeekMetric[], ma: number, lastClose: number): TierRow[] {
  const ratios = metrics.map((row) => row.closeRatio);
  const sample = ratios.length;
  return TIER_LEVELS.map((tier) => {
    const threshold = tier / 100;
    const below = ratios.reduce((count, ratio) => count + (ratio < threshold ? 1 : 0), 0);
    const active = (ratio: number) => (tier > 100 ? ratio > threshold : ratio < threshold);
    let episodeCount = 0;
    let episodeWeeks = 0;
    let latestEpisode: string | null = null;
    let open = false;
    for (const row of metrics) {
      if (!active(row.closeRatio)) {
        open = false;
        continue;
      }
      episodeWeeks += 1;
      latestEpisode = row.date;
      if (!open) {
        open = true;
        episodeCount += 1;
      }
    }
    return {
      tier,
      label: TIER_LABELS[tier],
      derived: DERIVED_TIER_LEVELS.includes(tier),
      level: (ma * tier) / 100,
      distancePct: (((ma * tier) / 100 - lastClose) / lastClose) * 100,
      ratioPercentile: sample === 0 ? 0 : (below / sample) * 100,
      episodeCount,
      episodeWeeks,
      latestEpisode,
    };
  });
}

/** Smallest tier whose level is still at or above the close (the band ceiling). */
export function highlightTier(rows: readonly TierRow[], lastClose: number): TierLevel {
  const ceiling = rows.find((row) => row.level >= lastClose);
  return ceiling?.tier ?? rows[rows.length - 1]?.tier ?? 100;
}

export function lowTag(ratio: number): LowTag {
  if (ratio < 0.85) return "史诗底";
  if (ratio < 0.9) return "重要底";
  return "其他";
}

/**
 * A significant low is a week whose effective low / MA55 is the minimum
 * inside ±neighborWeeks and is strictly below `lowThreshold` (default 95%).
 * Fewer than `neighborWeeks` of later MA weeks → unconfirmed.
 */
export function findSignificantLows(
  metrics: readonly WeekMetric[],
  neighborWeeks = MA55_PARAMS.neighborWeeks,
  lowThreshold = MA55_PARAMS.lowThreshold,
): LowRow[] {
  const rows: LowRow[] = [];
  for (let i = 0; i < metrics.length; i += 1) {
    const row = metrics[i];
    if (!row || row.lowRatio >= lowThreshold) continue;
    const from = Math.max(0, i - neighborWeeks);
    const to = Math.min(metrics.length - 1, i + neighborWeeks);
    let min = Infinity;
    for (let j = from; j <= to; j += 1) {
      const other = metrics[j];
      if (other && other.lowRatio < min) min = other.lowRatio;
    }
    if (row.lowRatio > min + 1e-12) continue;
    const weeksAfter = metrics.length - 1 - i;
    rows.push({
      weekEnd: row.date,
      weekLow: row.effectiveLow,
      ma55: row.ma,
      ratioPct: row.lowRatio * 100,
      confirmed: weeksAfter >= neighborWeeks,
      possiblyOpen: row.possiblyOpen,
      tag: lowTag(row.lowRatio),
    });
  }
  return rows;
}
