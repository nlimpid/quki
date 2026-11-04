import {
  findInstrument,
  type DailyBar,
  type OverviewTemperature,
  type TemperatureBand,
  type TemperatureFamilyId,
  type TemperatureHistoryPoint,
  type TemperatureMethod,
  type TemperatureResponse,
} from "@quki/types";

import { computeWeekMetrics } from "./metrics.js";
import { alignCloses, ROTATION_DEFAULTS } from "./rotation.js";
import { toWeeklyBars } from "./weekly.js";

/**
 * Dividend temperature v1.
 *
 * Signal A is the expanding percentile of weekly close/MA55 on the price index
 * (000922 or H30269). It is forward-filled from the latest week whose last
 * session is on or before the day, so a mid-week session cannot see that
 * week's eventual Friday close.
 * Signal B is the expanding percentile of the 40-session total-return spread
 * versus the broad leg (same definition as rotation `s` / `sPercentile`).
 * High means expensive. Both percentiles use only observations through that date.
 */

export const TEMPERATURE_SPREAD_WINDOW = ROTATION_DEFAULTS.spreadWindow;
export const TEMPERATURE_MA_WINDOW = 55;
/** Weekly close/MA55 readings required before a temperature is published. */
export const TEMPERATURE_MIN_WEEKS = 52;
/** Daily spreads required before Q and R publish. */
export const TEMPERATURE_MIN_SPREADS = 60;
/** Daily spreads required before the expanding z-score of S is used. */
export const TEMPERATURE_Z_MIN_SPREADS = 252;
/** Aligned broad session this many calendar days ahead of the price leg is stale. */
export const TEMPERATURE_PRICE_STALE_DAYS = 10;
export const MAPPING_SCORE_EPSILON = 0.02;

export const TEMPERATURE_FAMILIES = {
  dividend: { priceSymbol: "000922", totalReturnSymbol: "H00922" },
  lowvol: { priceSymbol: "H30269", totalReturnSymbol: "H20269" },
} as const;

export const TEMPERATURE_BROADS = ["H20903", "H00985"] as const;
export type TemperatureBroadSymbol = (typeof TEMPERATURE_BROADS)[number];

export type TemperatureMapping = "quantile" | "zscore" | "rule";

export type TemperatureCandidate = {
  id: string;
  mapping: TemperatureMapping;
  /** Weight on signal A. The rule tree's middle branch stays at 0.6. */
  w: number;
  k: number | null;
  paCold: number | null;
  pbCold: number | null;
  paHot: number | null;
  pbHot: number | null;
};

/**
 * Frozen by the walk-forward in docs/temperature-v1-backtest.md.
 * Primary leg 000922/H00922 vs H20903, test years 2012–2018, equal weight.
 * Do not retune this against the 2019+ holdout.
 */
export const TEMPERATURE_V1: {
  study: "dividend_temperature";
  ver: 1;
  mapping: TemperatureMapping;
  w: number;
  k: number | null;
  paCold: number | null;
  pbCold: number | null;
  paHot: number | null;
  pbHot: number | null;
  coldMax: number;
  hotMin: number;
  candidateId: string;
} = {
  study: "dividend_temperature",
  ver: 1,
  mapping: "quantile",
  w: 0.5,
  k: null,
  paCold: null,
  pbCold: null,
  paHot: null,
  pbHot: null,
  coldMax: 20,
  hotMin: 80,
  candidateId: "Q-w0.5",
};

export const Q_WEIGHTS = [0.5, 0.6, 0.7] as const;
export const Z_KS = [0.8, 1.0, 1.2] as const;

/** Small rule grid from the v1 memo. Not a search over every threshold. */
export const RULE_PRESETS = [
  { id: "base", paCold: 20, pbCold: 30, paHot: 80, pbHot: 70 },
  { id: "tight", paCold: 15, pbCold: 25, paHot: 85, pbHot: 75 },
  { id: "wide", paCold: 25, pbCold: 35, paHot: 75, pbHot: 65 },
] as const;

export const EXTREME_PRESETS = [
  { coldMax: 10, hotMin: 90 },
  { coldMax: 15, hotMin: 86 },
  { coldMax: 20, hotMin: 80 },
] as const;

export type TemperatureStudyLegs = {
  priceSymbol: string;
  totalReturnSymbol: string;
  broadSymbol: string;
};

export type SignalRow = {
  date: string;
  pa: number;
  pb: number;
  spread40: number;
  ratio: number;
  ma55: number;
  weekDate: string;
  weekSample: number;
  spreadSample: number;
  zA: number | null;
  zB: number | null;
  trClose: number;
  broadClose: number;
};

export type TemperaturePoint = {
  date: string;
  temperature: number;
  pa: number;
  pb: number;
  spread40: number;
  ratio: number;
  ma55: number;
};

export type TemperatureWriteDecision = {
  action: "skip" | "append";
  reason: "no_source" | "stale_price" | "unchanged" | "append";
};

const NARRATIVE_BANDS: readonly { hi: number; band: TemperatureBand; label: string }[] = [
  { hi: 15, band: "extreme_cold", label: "极冷" },
  { hi: 35, band: "cold", label: "偏冷" },
  { hi: 65, band: "neutral", label: "中性" },
  { hi: 85, band: "hot", label: "偏贵" },
  { hi: 100, band: "extreme_hot", label: "极热" },
];

export function temperatureCandidates(): TemperatureCandidate[] {
  const candidates: TemperatureCandidate[] = [];
  for (const w of Q_WEIGHTS) {
    candidates.push({
      id: `Q-w${w.toFixed(1)}`,
      mapping: "quantile",
      w,
      k: null,
      paCold: null,
      pbCold: null,
      paHot: null,
      pbHot: null,
    });
  }
  for (const w of Q_WEIGHTS) {
    for (const k of Z_KS) {
      candidates.push({
        id: `Z-w${w.toFixed(1)}-k${k.toFixed(1)}`,
        mapping: "zscore",
        w,
        k,
        paCold: null,
        pbCold: null,
        paHot: null,
        pbHot: null,
      });
    }
  }
  for (const rule of RULE_PRESETS) {
    candidates.push({
      id: `R-${rule.id}`,
      mapping: "rule",
      w: 0.6,
      k: null,
      paCold: rule.paCold,
      pbCold: rule.pbCold,
      paHot: rule.paHot,
      pbHot: rule.pbHot,
    });
  }
  return candidates;
}

export function productionCandidate(): TemperatureCandidate {
  return {
    id: TEMPERATURE_V1.candidateId,
    mapping: TEMPERATURE_V1.mapping,
    w: TEMPERATURE_V1.w,
    k: TEMPERATURE_V1.k,
    paCold: TEMPERATURE_V1.paCold,
    pbCold: TEMPERATURE_V1.pbCold,
    paHot: TEMPERATURE_V1.paHot,
    pbHot: TEMPERATURE_V1.pbHot,
  };
}

export function methodOf(mapping: TemperatureMapping): TemperatureMethod {
  if (mapping === "quantile") return "quantile_blend";
  if (mapping === "zscore") return "zscore_logistic";
  return "rule_tree";
}

export function productionStudyParams(legs: TemperatureStudyLegs): Record<string, unknown> {
  const params: Record<string, unknown> = {
    broadSymbol: legs.broadSymbol,
    coldMax: TEMPERATURE_V1.coldMax,
    hotMin: TEMPERATURE_V1.hotMin,
    maWindow: TEMPERATURE_MA_WINDOW,
    mapping: TEMPERATURE_V1.mapping,
    minSpreads: TEMPERATURE_MIN_SPREADS,
    minWeeks: TEMPERATURE_MIN_WEEKS,
    percentile: "expanding_strictly_below",
    priceSymbol: legs.priceSymbol,
    semantics: "high_means_expensive",
    spreadWindow: TEMPERATURE_SPREAD_WINDOW,
    study: TEMPERATURE_V1.study,
    totalReturnSymbol: legs.totalReturnSymbol,
    ver: TEMPERATURE_V1.ver,
    w: TEMPERATURE_V1.w,
    week: "iso-closed",
    zMinSpreads: TEMPERATURE_Z_MIN_SPREADS,
    zWindow: "expanding",
  };
  if (TEMPERATURE_V1.mapping === "zscore" && TEMPERATURE_V1.k != null) params.k = TEMPERATURE_V1.k;
  if (TEMPERATURE_V1.mapping === "rule") {
    params.paCold = TEMPERATURE_V1.paCold;
    params.pbCold = TEMPERATURE_V1.pbCold;
    params.paHot = TEMPERATURE_V1.paHot;
    params.pbHot = TEMPERATURE_V1.pbHot;
  }
  return params;
}

export function clampTemperature(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const rounded = Math.round(value);
  if (rounded < 1) return 1;
  if (rounded > 100) return 100;
  return rounded;
}

export function quantileTemperature(pa: number, pb: number, w: number): number {
  return clampTemperature(w * pa + (1 - w) * pb);
}

/** T = round(1 + 99 * sigmoid(k z)). A zero blend maps to 51, not 50. */
export function zTemperature(zA: number, zB: number, w: number, k: number): number {
  const z = w * zA + (1 - w) * zB;
  const sigmoid = 1 / (1 + Math.exp(-k * z));
  return clampTemperature(1 + 99 * sigmoid);
}

/**
 * Hot branch matches the memo: 85 + floor((P_A + P_B) / 40).
 * Cold branch mirrors it. Otherwise round(0.6 P_A + 0.4 P_B).
 * The 0.6 weight is fixed; only the corner thresholds are candidates.
 */
export function ruleTemperature(
  pa: number,
  pb: number,
  thresholds: { paCold: number; pbCold: number; paHot: number; pbHot: number },
): number {
  if (pa >= thresholds.paHot && pb >= thresholds.pbHot) {
    return clampTemperature(85 + Math.floor((pa + pb) / 40));
  }
  if (pa <= thresholds.paCold && pb <= thresholds.pbCold) {
    return clampTemperature(15 - Math.floor((100 - pa + (100 - pb)) / 40));
  }
  return clampTemperature(0.6 * pa + 0.4 * pb);
}

export function temperatureAt(
  row: Pick<SignalRow, "pa" | "pb" | "zA" | "zB" | "weekSample" | "spreadSample">,
  candidate: Pick<
    TemperatureCandidate,
    "mapping" | "w" | "k" | "paCold" | "pbCold" | "paHot" | "pbHot"
  >,
): number | null {
  if (row.weekSample < TEMPERATURE_MIN_WEEKS || row.spreadSample < TEMPERATURE_MIN_SPREADS) {
    return null;
  }
  if (candidate.mapping === "quantile") return quantileTemperature(row.pa, row.pb, candidate.w);
  if (candidate.mapping === "rule") {
    return ruleTemperature(row.pa, row.pb, {
      paCold: candidate.paCold ?? 20,
      pbCold: candidate.pbCold ?? 30,
      paHot: candidate.paHot ?? 80,
      pbHot: candidate.pbHot ?? 70,
    });
  }
  if (row.zA == null || row.zB == null || row.spreadSample < TEMPERATURE_Z_MIN_SPREADS) return null;
  return zTemperature(row.zA, row.zB, candidate.w, candidate.k ?? 1);
}

export function temperaturePoints(
  rows: readonly SignalRow[],
  candidate: TemperatureCandidate,
): TemperaturePoint[] {
  const points: TemperaturePoint[] = [];
  for (const row of rows) {
    const temperature = temperatureAt(row, candidate);
    if (temperature == null) continue;
    points.push({
      date: row.date,
      temperature,
      pa: row.pa,
      pb: row.pb,
      spread40: row.spread40,
      ratio: row.ratio,
      ma55: row.ma55,
    });
  }
  return points;
}

/** True once every mapping, including Z, can be scored on this row. */
export function isComparable(
  row: Pick<SignalRow, "zA" | "zB" | "weekSample" | "spreadSample">,
): boolean {
  return (
    row.zA != null &&
    row.zB != null &&
    row.weekSample >= TEMPERATURE_MIN_WEEKS &&
    row.spreadSample >= TEMPERATURE_Z_MIN_SPREADS
  );
}

export function calendarDaysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

/**
 * Cron gate. Append only when the aligned total-return session is strictly
 * newer than the stored temperature date and the price leg is not stale.
 * An unchanged source date is a no-op: callers must not upsert.
 */
export function decideTemperatureWrite(input: {
  latestAlignedDate: string | null;
  latestPriceDate: string | null;
  storedThrough: string | null;
}): TemperatureWriteDecision {
  const { latestAlignedDate, latestPriceDate, storedThrough } = input;
  if (!latestAlignedDate || !latestPriceDate) return { action: "skip", reason: "no_source" };
  if (calendarDaysBetween(latestPriceDate, latestAlignedDate) > TEMPERATURE_PRICE_STALE_DAYS) {
    return { action: "skip", reason: "stale_price" };
  }
  if (storedThrough != null && storedThrough >= latestAlignedDate) {
    return { action: "skip", reason: "unchanged" };
  }
  return { action: "append", reason: "append" };
}

/** Dates on or before the watermark are dropped so a retry cannot rewrite them. */
export function selectNewTemperatureRows(
  points: readonly TemperaturePoint[],
  storedThrough: string | null,
  latestAlignedDate: string,
): TemperaturePoint[] {
  return points.filter(
    (point) =>
      point.date <= latestAlignedDate && (storedThrough == null || point.date > storedThrough),
  );
}

export function temperatureBand(value: number): { band: TemperatureBand; label: string } {
  for (const row of NARRATIVE_BANDS) {
    if (value <= row.hi) return { band: row.band, label: row.label };
  }
  return { band: "extreme_hot", label: "极热" };
}

export function temperatureExtreme(
  value: number,
  coldMax = TEMPERATURE_V1.coldMax,
  hotMin = TEMPERATURE_V1.hotMin,
): "cold" | "hot" | null {
  if (value <= coldMax) return "cold";
  if (value >= hotMin) return "hot";
  return null;
}

export function temperatureFamilyForSymbol(symbol: string): TemperatureFamilyId | null {
  const code = symbol.toUpperCase();
  if (code === "000922" || code === "H00922") return "dividend";
  if (code === "H30269" || code === "H20269") return "lowvol";
  return null;
}

export function parseTemperatureQuery(
  family: string | undefined,
  broad: string | undefined,
): { family: TemperatureFamilyId; broad: TemperatureBroadSymbol } | null {
  const familyId = (family ?? "dividend").toLowerCase();
  const broadSymbol = (broad ?? "H20903").toUpperCase();
  if (familyId !== "dividend" && familyId !== "lowvol") return null;
  if (broadSymbol !== "H20903" && broadSymbol !== "H00985") return null;
  return { family: familyId, broad: broadSymbol };
}

export function temperatureLegs(
  family: TemperatureFamilyId,
  broad: TemperatureBroadSymbol,
): TemperatureStudyLegs {
  const legs = TEMPERATURE_FAMILIES[family];
  return {
    priceSymbol: legs.priceSymbol,
    totalReturnSymbol: legs.totalReturnSymbol,
    broadSymbol: broad,
  };
}

function expandingZ(values: readonly number[], minSample: number): (number | null)[] {
  let sum = 0;
  let sumSq = 0;
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] ?? 0;
    sum += value;
    sumSq += value * value;
    const n = i + 1;
    if (n < minSample) {
      out.push(null);
      continue;
    }
    const mean = sum / n;
    const variance = (sumSq - (sum * sum) / n) / (n - 1);
    const std = Math.sqrt(Math.max(0, variance));
    out.push(std > 1e-12 ? (value - mean) / std : 0);
  }
  return out;
}

function latestIndexAtOrBefore(dates: readonly string[], day: string): number {
  let lo = 0;
  let hi = dates.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const value = dates[mid];
    if (value != null && value <= day) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

function roundTo(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/**
 * Daily signal panel. Passing the full history is safe: week bars are dated on
 * their last session, and the percentile / z-score at each index use only
 * observations up to that index.
 */
export function buildSignalRows(input: {
  priceDaily: readonly DailyBar[];
  totalReturnDaily: readonly DailyBar[];
  broadDaily: readonly DailyBar[];
  spreadWindow?: number;
}): SignalRow[] {
  const spreadWindow = input.spreadWindow ?? TEMPERATURE_SPREAD_WINDOW;
  const metrics = computeWeekMetrics(toWeeklyBars(input.priceDaily), TEMPERATURE_MA_WINDOW);
  const weekDates = metrics.map((row) => row.date);
  const zA = expandingZ(
    metrics.map((row) => row.closeRatio),
    TEMPERATURE_MIN_WEEKS,
  );
  const aligned = alignCloses(input.totalReturnDaily, input.broadDaily);
  const spreads: (number | null)[] = aligned.map((row, index) => {
    if (index < spreadWindow) return null;
    const prev = aligned[index - spreadWindow];
    if (!prev || prev.a === 0 || prev.b === 0) return null;
    return row.a / prev.a - 1 - (row.b / prev.b - 1);
  });
  const spreadValues: number[] = [];
  for (const value of spreads) if (value != null) spreadValues.push(value);
  const zB = expandingZ(spreadValues, TEMPERATURE_Z_MIN_SPREADS);

  const rows: SignalRow[] = [];
  let spreadIndex = -1;
  for (let i = 0; i < aligned.length; i += 1) {
    const spread = spreads[i];
    const session = aligned[i];
    if (spread == null || !session) continue;
    spreadIndex += 1;
    const weekIndex = latestIndexAtOrBefore(weekDates, session.date);
    const week = weekIndex >= 0 ? metrics[weekIndex] : undefined;
    if (!week) continue;
    const sample = spreadIndex + 1;
    let below = 0;
    for (let j = 0; j < spreadIndex; j += 1) {
      const prior = spreadValues[j];
      if (prior != null && prior < spread) below += 1;
    }
    rows.push({
      date: session.date,
      pa: week.percentile,
      pb: (below / sample) * 100,
      spread40: spread,
      ratio: week.closeRatio,
      ma55: week.ma,
      weekDate: week.date,
      weekSample: weekIndex + 1,
      spreadSample: sample,
      zA: zA[weekIndex] ?? null,
      zB: zB[spreadIndex] ?? null,
      trClose: session.a,
      broadClose: session.b,
    });
  }
  return rows;
}

export function buildTemperatureReading(
  points: readonly TemperaturePoint[],
  legs: TemperatureStudyLegs,
): TemperatureResponse | null {
  const latest = points[points.length - 1];
  if (!latest) return null;
  const band = temperatureBand(latest.temperature);
  const price = findInstrument(legs.priceSymbol);
  const totalReturn = findInstrument(legs.totalReturnSymbol);
  const broad = findInstrument(legs.broadSymbol);
  const history: TemperatureHistoryPoint[] = points.map((point) => ({
    date: point.date,
    temperature: point.temperature,
    pa: roundTo(point.pa, 2),
    pb: roundTo(point.pb, 2),
    spread40: roundTo(point.spread40, 6),
  }));
  return {
    asOf: `${latest.date}T15:00:00+08:00`,
    tradeDate: latest.date,
    temperature: latest.temperature,
    band: band.band,
    label: band.label,
    extreme: temperatureExtreme(latest.temperature),
    semantics: "high_means_expensive",
    method: methodOf(TEMPERATURE_V1.mapping),
    version: TEMPERATURE_V1.ver,
    pa: roundTo(latest.pa, 2),
    pb: roundTo(latest.pb, 2),
    spread40: roundTo(latest.spread40, 6),
    ratio: roundTo(latest.ratio, 6),
    weightOwn: TEMPERATURE_V1.w,
    coldMax: TEMPERATURE_V1.coldMax,
    hotMin: TEMPERATURE_V1.hotMin,
    dividend: {
      symbol: legs.totalReturnSymbol,
      name: totalReturn?.name ?? legs.totalReturnSymbol,
      priceSymbol: legs.priceSymbol,
      priceName: price?.name ?? legs.priceSymbol,
    },
    broad: { symbol: legs.broadSymbol, name: broad?.name ?? legs.broadSymbol },
    history,
  };
}

export function compactTemperature(reading: TemperatureResponse): OverviewTemperature {
  return {
    value: reading.temperature,
    tradeDate: reading.tradeDate,
    asOf: reading.asOf,
    method: reading.method,
    version: reading.version,
    pa: reading.pa,
    pb: reading.pb,
    spread40: reading.spread40,
    band: reading.band,
  };
}

export function lastBarDate(bars: readonly { date: string }[]): string | null {
  let latest: string | null = null;
  for (const bar of bars) {
    if (latest == null || bar.date > latest) latest = bar.date;
  }
  return latest;
}

export function latestAlignedSession(
  totalReturn: readonly DailyBar[],
  broad: readonly DailyBar[],
): string | null {
  const aligned = alignCloses(totalReturn, broad);
  return aligned[aligned.length - 1]?.date ?? null;
}
