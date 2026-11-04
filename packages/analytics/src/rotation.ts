import type { DailyBar, ResolvedRotationPair } from "@quki/types";

export const ROTATION_DEFAULTS = {
  maWindow: 242,
  bandSigma: 2,
  spreadWindow: 40,
  rsiWindow: 14,
  extremePercentile: 5,
} as const;

export type RotationOptions = {
  maWindow?: number;
  bandSigma?: number;
  spreadWindow?: number;
  rsiWindow?: number;
  extremePercentile?: number;
};

export type AlignedClose = { date: string; a: number; b: number };

export type BandCross = "above" | "below";
export type ZeroCross = "up" | "down";

export type RotationPoint = {
  date: string;
  aRebase: number;
  bRebase: number;
  r: number;
  ma: number | null;
  upper: number | null;
  lower: number | null;
  pctB: number | null;
  bandwidth: number | null;
  /** 40-day return spread, as a fraction. */
  s: number | null;
  sMa: number | null;
  /** Expanding percentile of S, 0–100. Null until S exists. */
  sPercentile: number | null;
  rsi: number | null;
  rsiMa: number | null;
  bandCross: BandCross | null;
  spreadCross: ZeroCross | null;
  spreadExtreme: boolean;
};

export function alignCloses(
  aBars: readonly DailyBar[],
  bBars: readonly DailyBar[],
): AlignedClose[] {
  const bByDate = new Map(bBars.map((bar) => [bar.date, bar.close]));
  const aligned: AlignedClose[] = [];
  for (const bar of [...aBars].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    const b = bByDate.get(bar.date);
    if (b == null || b === 0 || bar.close === 0) continue;
    aligned.push({ date: bar.date, a: bar.close, b });
  }
  return aligned;
}

function sma(values: readonly number[], end: number, window: number): number | null {
  if (end < window - 1) return null;
  let sum = 0;
  for (let i = end - window + 1; i <= end; i += 1) sum += values[i] ?? 0;
  return sum / window;
}

function populationStdev(
  values: readonly number[],
  end: number,
  window: number,
  mean: number,
): number {
  let acc = 0;
  for (let i = end - window + 1; i <= end; i += 1) {
    const diff = (values[i] ?? 0) - mean;
    acc += diff * diff;
  }
  return Math.sqrt(acc / window);
}

function rsiWilder(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = (values[i] ?? 0) - (values[i - 1] ?? 0);
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const toRsi = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  out[period] = toRsi(avgGain, avgLoss);
  for (let i = period + 1; i < values.length; i += 1) {
    const diff = (values[i] ?? 0) - (values[i - 1] ?? 0);
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

function nullableSma(
  values: readonly (number | null)[],
  end: number,
  window: number,
): number | null {
  if (end < window - 1) return null;
  let sum = 0;
  for (let i = end - window + 1; i <= end; i += 1) {
    const value = values[i];
    if (value == null) return null;
    sum += value;
  }
  return sum / window;
}

/**
 * Relative-strength study on aligned closes.
 * R is A/B rebased to 1 on the first common session.
 * Bollinger is MA ± sigma * population stdev over the same window.
 * S is the 40-session return spread. RSI uses Wilder smoothing.
 */
export function computeRotation(
  aligned: readonly AlignedClose[],
  options: RotationOptions = {},
): RotationPoint[] {
  if (aligned.length === 0) return [];
  const maWindow = options.maWindow ?? ROTATION_DEFAULTS.maWindow;
  const bandSigma = options.bandSigma ?? ROTATION_DEFAULTS.bandSigma;
  const spreadWindow = options.spreadWindow ?? ROTATION_DEFAULTS.spreadWindow;
  const rsiWindow = options.rsiWindow ?? ROTATION_DEFAULTS.rsiWindow;
  const extreme = options.extremePercentile ?? ROTATION_DEFAULTS.extremePercentile;
  const first = aligned[0];
  if (!first) return [];
  const base = first.a / first.b;
  const rValues = aligned.map((row) => row.a / row.b / base);
  const rsi = rsiWilder(rValues, rsiWindow);
  const spreads: (number | null)[] = aligned.map((row, index) => {
    if (index < spreadWindow) return null;
    const prev = aligned[index - spreadWindow];
    if (!prev || prev.a === 0 || prev.b === 0) return null;
    return row.a / prev.a - 1 - (row.b / prev.b - 1);
  });

  const points: RotationPoint[] = [];
  const spreadSample: number[] = [];
  for (let i = 0; i < aligned.length; i += 1) {
    const row = aligned[i];
    const r = rValues[i];
    if (!row || r == null) continue;
    const ma = sma(rValues, i, maWindow);
    let upper: number | null = null;
    let lower: number | null = null;
    let pctB: number | null = null;
    let bandwidth: number | null = null;
    if (ma != null) {
      const sigma = populationStdev(rValues, i, maWindow, ma);
      upper = ma + bandSigma * sigma;
      lower = ma - bandSigma * sigma;
      const width = upper - lower;
      pctB = width === 0 ? null : (r - lower) / width;
      bandwidth = ma === 0 ? null : width / ma;
    }
    const s = spreads[i] ?? null;
    let sPercentile: number | null = null;
    if (s != null) {
      let below = 0;
      for (const value of spreadSample) if (value < s) below += 1;
      spreadSample.push(s);
      sPercentile = (below / spreadSample.length) * 100;
    }
    const sMa = nullableSma(spreads, i, maWindow);
    const prev = points[points.length - 1];
    let bandCross: BandCross | null = null;
    if (prev && upper != null && lower != null && prev.upper != null && prev.lower != null) {
      if (prev.r <= prev.upper && r > upper) bandCross = "above";
      else if (prev.r >= prev.lower && r < lower) bandCross = "below";
    }
    let spreadCross: ZeroCross | null = null;
    if (prev?.sMa != null && sMa != null) {
      if (prev.sMa < 0 && sMa >= 0) spreadCross = "up";
      else if (prev.sMa > 0 && sMa <= 0) spreadCross = "down";
    }
    const prevPct = prev?.sPercentile;
    const spreadExtreme =
      sPercentile != null &&
      prevPct != null &&
      ((prevPct > extreme && sPercentile <= extreme) ||
        (prevPct < 100 - extreme && sPercentile >= 100 - extreme));
    points.push({
      date: row.date,
      aRebase: row.a / first.a,
      bRebase: row.b / first.b,
      r,
      ma,
      upper,
      lower,
      pctB,
      bandwidth,
      s,
      sMa,
      sPercentile,
      rsi: rsi[i] ?? null,
      rsiMa: nullableSma(rsi, i, maWindow),
      bandCross,
      spreadCross,
      spreadExtreme,
    });
  }
  return points;
}

export type RotationMarker = {
  date: string;
  kind: "band-above" | "band-below" | "spread-up" | "spread-down" | "spread-extreme";
  label: string;
  value: number;
};

export type RotationView = {
  pair: ResolvedRotationPair;
  asOf: string;
  latest: {
    date: string;
    r: number;
    ma: number | null;
    upper: number | null;
    lower: number | null;
    pctB: number | null;
    bandwidth: number | null;
    s: number | null;
    sPercentile: number | null;
    rsi: number | null;
    rsiMa: number | null;
    zone: "上轨之上" | "轨道内" | "下轨之下" | "样本不足";
    lastSpreadCross: { date: string; direction: ZeroCross } | null;
  };
  points: {
    date: string;
    a: number;
    b: number;
    r: number;
    ma: number | null;
    upper: number | null;
    lower: number | null;
    s: number | null;
    sMa: number | null;
    rsi: number | null;
    rsiMa: number | null;
  }[];
  markers: RotationMarker[];
};

function zoneOf(point: RotationPoint): RotationView["latest"]["zone"] {
  if (point.upper == null || point.lower == null) return "样本不足";
  if (point.r > point.upper) return "上轨之上";
  if (point.r < point.lower) return "下轨之下";
  return "轨道内";
}

export function buildRotationView(
  points: readonly RotationPoint[],
  pair: ResolvedRotationPair,
): RotationView | null {
  const last = points[points.length - 1];
  if (!last) return null;
  const markers: RotationMarker[] = [];
  for (const point of points) {
    if (point.bandCross === "above") {
      markers.push({ date: point.date, kind: "band-above", label: "突破上轨", value: point.r });
    } else if (point.bandCross === "below") {
      markers.push({ date: point.date, kind: "band-below", label: "跌破下轨", value: point.r });
    }
    if (point.spreadCross === "up") {
      markers.push({
        date: point.date,
        kind: "spread-up",
        label: "收益差均线上穿 0",
        value: point.sMa ?? 0,
      });
    } else if (point.spreadCross === "down") {
      markers.push({
        date: point.date,
        kind: "spread-down",
        label: "收益差均线下穿 0",
        value: point.sMa ?? 0,
      });
    }
    if (point.spreadExtreme && point.s != null && point.sPercentile != null) {
      markers.push({
        date: point.date,
        kind: "spread-extreme",
        label: `${point.sPercentile.toFixed(0)}%分位`,
        value: point.s,
      });
    }
  }
  return {
    pair,
    asOf: `${last.date}T15:00:00+08:00`,
    latest: {
      date: last.date,
      r: last.r,
      ma: last.ma,
      upper: last.upper,
      lower: last.lower,
      pctB: last.pctB,
      bandwidth: last.bandwidth,
      s: last.s,
      sPercentile: last.sPercentile,
      rsi: last.rsi,
      rsiMa: last.rsiMa,
      zone: zoneOf(last),
      lastSpreadCross: latestSpreadCross(points),
    },
    points: points.map((point) => ({
      date: point.date,
      a: point.aRebase,
      b: point.bRebase,
      r: point.r,
      ma: point.ma,
      upper: point.upper,
      lower: point.lower,
      s: point.s,
      sMa: point.sMa,
      rsi: point.rsi,
      rsiMa: point.rsiMa,
    })),
    markers,
  };
}

export function latestSpreadCross(points: readonly RotationPoint[]): {
  date: string;
  direction: ZeroCross;
} | null {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = points[i];
    if (point?.spreadCross) return { date: point.date, direction: point.spreadCross };
  }
  return null;
}
