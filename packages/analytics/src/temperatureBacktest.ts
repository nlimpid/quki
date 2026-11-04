import type { TemperatureCandidate, TemperatureMapping } from "./temperature.js";
import {
  EXTREME_PRESETS,
  MAPPING_SCORE_EPSILON,
  isComparable,
  temperatureAt,
  temperatureCandidates,
} from "./temperature.js";
import type { SignalRow } from "./temperature.js";

/** Trading sessions. 242 matches the rotation year window. */
export const HORIZONS = [
  { key: "1M", sessions: 21 },
  { key: "3M", sessions: 63 },
  { key: "6M", sessions: 126 },
  { key: "1Y", sessions: 242 },
] as const;

export type HorizonKey = (typeof HORIZONS)[number]["key"];

export const WALK_FORWARD_TRAIN_YEARS = 5;
export const MIN_TRAIN_DAYS = 400;
export const MIN_TEST_DAYS = 80;
export const MIN_EXTREME_SAMPLES = 30;
export const HOLDOUT_CUT = "2018-12-31";
export const HOLDOUT_START = "2019-01-01";

const NARRATIVE_BUCKETS = [
  { key: "extreme_cold", label: "极冷", lo: 1, hi: 15 },
  { key: "cold", label: "偏冷", lo: 16, hi: 35 },
  { key: "neutral", label: "中性", lo: 36, hi: 65 },
  { key: "hot", label: "偏贵", lo: 66, hi: 85 },
  { key: "extreme_hot", label: "极热", lo: 86, hi: 100 },
] as const;

export type Dist = {
  n: number;
  mean: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  /** Share of returns strictly above zero. */
  winRate: number | null;
  /** Share of returns strictly below zero. */
  shortfallRate: number | null;
};

export type SideStats = { abs: Dist; rel: Dist };

export type BucketStat = {
  key: string;
  label: string;
  lo: number;
  hi: number;
  byHorizon: Record<HorizonKey, SideStats>;
};

export type ExtremeStat = {
  coldMax: number;
  hotMin: number;
  byHorizon: Record<HorizonKey, { cold: SideStats; hot: SideStats }>;
};

export type WindowReport = {
  start: string | null;
  end: string | null;
  n: number;
  labeled1y: number;
  /** −Spearman(T, forward 1Y relative return). Positive means hotter preceded weaker relative returns. */
  score: number | null;
  spearmanAbs1y: number | null;
  monthEndScore: number | null;
  buckets: BucketStat[];
  /** Spearman of narrative-bucket order vs mean return. Negative is the expensive→weaker direction. */
  bucketSpearman: Record<HorizonKey, { abs: number | null; rel: number | null }>;
  deciles: BucketStat[];
  extremes: ExtremeStat[];
  /** All calibrated threshold pairs, including ones that were not selected. */
  extremeGrid: ExtremeStat[];
};

export type FoldChoice = {
  testYear: number;
  trainN: number;
  testN: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  byMapping: Record<
    TemperatureMapping,
    { candidateId: string; trainScore: number; testScore: number | null }
  >;
};

export type UniverseStudy = {
  comparableStart: string | null;
  comparableEnd: string | null;
  comparableN: number;
  paPbPearson: number | null;
  folds: FoldChoice[];
  mappingScores: Record<
    TemperatureMapping,
    { meanTestScore: number | null; frozenTestScore: number | null; folds: number }
  >;
  /** Each mapping frozen on pre-2019 folds, then scored once on 2019+. */
  mappingHoldout: Record<
    TemperatureMapping,
    {
      candidate: TemperatureCandidate;
      outOfSample: WindowReport;
      trainScore: number | null;
    }
  >;
  chosenMapping: TemperatureMapping;
  /** Modal candidate among walk-forward folds whose train window ends by 2018. */
  candidate: TemperatureCandidate;
  longWindowCandidateId: string | null;
  extremes: { coldMax: number; hotMin: number; separation: number | null; qualified: boolean };
  extremeVotes: string[];
  notes: string[];
  ownHoldout: { inSample: WindowReport; outOfSample: WindowReport; trainScore: number | null };
};

export type PreparedRow = SignalRow & {
  abs: Record<HorizonKey, number | null>;
  rel: Record<HorizonKey, number | null>;
  /** Session date the forward return is measured to. Null when the horizon runs off the sample. */
  labelDate: Record<HorizonKey, string | null>;
};

const MAPPINGS: readonly TemperatureMapping[] = ["quantile", "zscore", "rule"];

export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n !== ys.length || n < 3) return null;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += xs[i] ?? 0;
    sumY += ys[i] ?? 0;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const vx = (xs[i] ?? 0) - meanX;
    const vy = (ys[i] ?? 0) - meanY;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  if (dx <= 0 || dy <= 0) return null;
  return num / Math.sqrt(dx * dy);
}

function averageRanks(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value || a.index - b.index);
  const ranks = new Array<number>(values.length).fill(0);
  let cursor = 0;
  while (cursor < indexed.length) {
    let end = cursor;
    while (end + 1 < indexed.length && indexed[end + 1]?.value === indexed[cursor]?.value) end += 1;
    const average = (cursor + 1 + end + 1) / 2;
    for (let k = cursor; k <= end; k += 1) {
      const item = indexed[k];
      if (item) ranks[item.index] = average;
    }
    cursor = end + 1;
  }
  return ranks;
}

export function spearman(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  return pearson(averageRanks(xs), averageRanks(ys));
}

function quantileSorted(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const only = sorted[0];
  if (sorted.length === 1) return only ?? null;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo];
  const b = sorted[hi];
  if (a == null || b == null) return null;
  return a + (b - a) * (pos - lo);
}

export function summarizeDist(values: readonly number[]): Dist {
  if (values.length === 0) {
    return {
      n: 0,
      mean: null,
      median: null,
      p25: null,
      p75: null,
      winRate: null,
      shortfallRate: null,
    };
  }
  let sum = 0;
  let wins = 0;
  let losses = 0;
  for (const value of values) {
    sum += value;
    if (value > 0) wins += 1;
    else if (value < 0) losses += 1;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    mean: sum / values.length,
    median: quantileSorted(sorted, 0.5),
    p25: quantileSorted(sorted, 0.25),
    p75: quantileSorted(sorted, 0.75),
    winRate: wins / values.length,
    shortfallRate: losses / values.length,
  };
}

export function prepareSignals(rows: readonly SignalRow[]): PreparedRow[] {
  return rows.map((row, index) => {
    const abs = { "1M": null, "3M": null, "6M": null, "1Y": null } as Record<
      HorizonKey,
      number | null
    >;
    const rel = { "1M": null, "3M": null, "6M": null, "1Y": null } as Record<
      HorizonKey,
      number | null
    >;
    const labelDate = { "1M": null, "3M": null, "6M": null, "1Y": null } as Record<
      HorizonKey,
      string | null
    >;
    for (const horizon of HORIZONS) {
      const future = rows[index + horizon.sessions];
      if (!future || row.trClose === 0 || row.broadClose === 0) continue;
      const absolute = future.trClose / row.trClose - 1;
      const broad = future.broadClose / row.broadClose - 1;
      abs[horizon.key] = absolute;
      rel[horizon.key] = absolute - broad;
      labelDate[horizon.key] = future.date;
    }
    return { ...row, abs, rel, labelDate };
  });
}

export type FoldMask = {
  testYear: number;
  train: number[];
  test: number[];
};

/**
 * Rolling 5-year train, next calendar year test.
 * A train row's 1Y label must fall before the test year, so the fold does not
 * fit on prices from the year it is about to score.
 */
export function walkForwardMasks(
  dates: readonly string[],
  labelDates: readonly (string | null)[],
): FoldMask[] {
  if (dates.length === 0) return [];
  let minYear = Number(dates[0]?.slice(0, 4));
  let maxYear = minYear;
  for (const date of dates) {
    const year = Number(date.slice(0, 4));
    if (year < minYear) minYear = year;
    if (year > maxYear) maxYear = year;
  }
  const folds: FoldMask[] = [];
  for (let testYear = minYear + WALK_FORWARD_TRAIN_YEARS; testYear <= maxYear; testYear += 1) {
    const train: number[] = [];
    const test: number[] = [];
    const trainStart = `${testYear - WALK_FORWARD_TRAIN_YEARS}-01-01`;
    const testStart = `${testYear}-01-01`;
    const testEnd = `${testYear}-12-31`;
    for (let i = 0; i < dates.length; i += 1) {
      const date = dates[i];
      const label = labelDates[i];
      if (!date || !label) continue;
      if (date >= trainStart && date < testStart && label < testStart) train.push(i);
      else if (date >= testStart && date <= testEnd) test.push(i);
    }
    if (train.length < MIN_TRAIN_DAYS || test.length < MIN_TEST_DAYS) continue;
    folds.push({ testYear, train, test });
  }
  return folds;
}

/** Prefer Q when its walk-forward score is within `epsilon` of the best mapping. */
export function chooseMapping(
  scores: Record<TemperatureMapping, number>,
  epsilon = MAPPING_SCORE_EPSILON,
): TemperatureMapping {
  let best: TemperatureMapping = "quantile";
  for (const mapping of MAPPINGS) {
    if (scores[mapping] > scores[best]) best = mapping;
  }
  if (scores.quantile >= scores[best] - epsilon) return "quantile";
  return best;
}

export function modalId(ids: readonly string[], tieBreak: string | null): string | null {
  if (ids.length === 0) return tieBreak;
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  let bestCount = 0;
  for (const count of counts.values()) if (count > bestCount) bestCount = count;
  const tied = [...counts.entries()]
    .filter(([, count]) => count === bestCount)
    .map(([id]) => id)
    .sort();
  if (tieBreak && tied.includes(tieBreak)) return tieBreak;
  return tied[0] ?? null;
}

function scoreAt(
  rows: readonly PreparedRow[],
  temps: readonly (number | null)[],
  indices: readonly number[],
): number | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const index of indices) {
    const temp = temps[index];
    const value = rows[index]?.rel["1Y"];
    if (temp == null || value == null) continue;
    xs.push(temp);
    ys.push(value);
  }
  const rho = spearman(xs, ys);
  if (rho == null) return null;
  return -rho;
}

export function bestCandidateId(
  pool: readonly TemperatureCandidate[],
  tempsById: ReadonlyMap<string, readonly (number | null)[]>,
  rows: readonly PreparedRow[],
  indices: readonly number[],
): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;
  for (const candidate of pool) {
    const temps = tempsById.get(candidate.id);
    if (!temps) continue;
    const score = scoreAt(rows, temps, indices);
    if (score == null) continue;
    if (!best || score > best.score) best = { id: candidate.id, score };
  }
  return best;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function selectExtremeThresholds(
  temps: readonly (number | null)[],
  rel: readonly (number | null)[],
  indices: readonly number[],
): { coldMax: number; hotMin: number; separation: number | null; qualified: boolean } {
  let best: {
    coldMax: number;
    hotMin: number;
    separation: number;
    hits: number;
  } | null = null;
  for (const preset of EXTREME_PRESETS) {
    const cold: number[] = [];
    const hot: number[] = [];
    for (const index of indices) {
      const temp = temps[index];
      const value = rel[index];
      if (temp == null || value == null) continue;
      if (temp <= preset.coldMax) cold.push(value);
      if (temp >= preset.hotMin) hot.push(value);
    }
    if (cold.length < MIN_EXTREME_SAMPLES || hot.length < MIN_EXTREME_SAMPLES) continue;
    const separation = (mean(cold) ?? 0) - (mean(hot) ?? 0);
    const hits =
      cold.filter((value) => value > 0).length / cold.length +
      hot.filter((value) => value < 0).length / hot.length;
    const better =
      !best ||
      separation > best.separation + 1e-12 ||
      (Math.abs(separation - best.separation) <= 1e-12 && hits > best.hits + 1e-12) ||
      (Math.abs(separation - best.separation) <= 1e-12 &&
        Math.abs(hits - best.hits) <= 1e-12 &&
        preset.coldMax === 10 &&
        preset.hotMin === 90);
    if (better) best = { coldMax: preset.coldMax, hotMin: preset.hotMin, separation, hits };
  }
  if (!best) return { coldMax: 10, hotMin: 90, separation: null, qualified: false };
  return {
    coldMax: best.coldMax,
    hotMin: best.hotMin,
    separation: best.separation,
    qualified: true,
  };
}

function sideStats(
  rows: readonly PreparedRow[],
  temps: readonly (number | null)[],
  indices: readonly number[],
  horizon: HorizonKey,
  accept: (temp: number) => boolean,
): SideStats {
  const abs: number[] = [];
  const rel: number[] = [];
  for (const index of indices) {
    const temp = temps[index];
    if (temp == null || !accept(temp)) continue;
    const row = rows[index];
    const absolute = row?.abs[horizon];
    const relative = row?.rel[horizon];
    if (absolute != null) abs.push(absolute);
    if (relative != null) rel.push(relative);
  }
  return { abs: summarizeDist(abs), rel: summarizeDist(rel) };
}

function bucketRows(
  rows: readonly PreparedRow[],
  temps: readonly (number | null)[],
  indices: readonly number[],
  bands: readonly { key: string; label: string; lo: number; hi: number }[],
): {
  rows: BucketStat[];
  spearman: Record<HorizonKey, { abs: number | null; rel: number | null }>;
} {
  const stats: BucketStat[] = bands.map((band) => {
    const byHorizon = {} as Record<HorizonKey, SideStats>;
    for (const horizon of HORIZONS) {
      byHorizon[horizon.key] = sideStats(
        rows,
        temps,
        indices,
        horizon.key,
        (temp) => temp >= band.lo && temp <= band.hi,
      );
    }
    return { ...band, byHorizon };
  });
  const spearmanByHorizon = {} as Record<HorizonKey, { abs: number | null; rel: number | null }>;
  for (const horizon of HORIZONS) {
    const absMeans: (number | null)[] = [];
    const relMeans: (number | null)[] = [];
    for (const row of stats) {
      const abs = row.byHorizon[horizon.key].abs;
      const rel = row.byHorizon[horizon.key].rel;
      absMeans.push(abs.n >= 20 ? abs.mean : null);
      relMeans.push(rel.n >= 20 ? rel.mean : null);
    }
    const rho = (means: (number | null)[]) => {
      const xs: number[] = [];
      const ys: number[] = [];
      means.forEach((value, index) => {
        if (value == null) return;
        xs.push(index);
        ys.push(value);
      });
      return spearman(xs, ys);
    };
    spearmanByHorizon[horizon.key] = { abs: rho(absMeans), rel: rho(relMeans) };
  }
  return { rows: stats, spearman: spearmanByHorizon };
}

function decileBands(): { key: string; label: string; lo: number; hi: number }[] {
  return Array.from({ length: 10 }, (_, index) => {
    const lo = index * 10 + 1;
    const hi = index === 9 ? 100 : (index + 1) * 10;
    return { key: `d${index + 1}`, label: `${lo}–${hi}`, lo, hi };
  });
}

function monthEndIndices(rows: readonly PreparedRow[], indices: readonly number[]): number[] {
  const last = new Map<string, number>();
  for (const index of indices) {
    const date = rows[index]?.date;
    if (!date || rows[index]?.rel["1Y"] == null) continue;
    last.set(date.slice(0, 7), index);
  }
  return [...last.values()];
}

export function reportWindow(
  rows: readonly PreparedRow[],
  temps: readonly (number | null)[],
  indices: readonly number[],
  coldMax: number,
  hotMin: number,
): WindowReport {
  const labeled = indices.filter((index) => rows[index]?.rel["1Y"] != null);
  const dates = indices
    .map((index) => rows[index]?.date)
    .filter((date): date is string => !!date)
    .sort();
  const buckets = bucketRows(rows, temps, indices, NARRATIVE_BUCKETS);
  const deciles = bucketRows(rows, temps, indices, decileBands());
  const zone = (lo: (temp: number) => boolean, hi: (temp: number) => boolean) => {
    const byHorizon = {} as ExtremeStat["byHorizon"];
    for (const horizon of HORIZONS) {
      byHorizon[horizon.key] = {
        cold: sideStats(rows, temps, indices, horizon.key, lo),
        hot: sideStats(rows, temps, indices, horizon.key, hi),
      };
    }
    return byHorizon;
  };
  const byHorizon = zone(
    (temp) => temp <= coldMax,
    (temp) => temp >= hotMin,
  );
  const extremeGrid = EXTREME_PRESETS.map((preset) => ({
    coldMax: preset.coldMax,
    hotMin: preset.hotMin,
    byHorizon: zone(
      (temp) => temp <= preset.coldMax,
      (temp) => temp >= preset.hotMin,
    ),
  }));
  const xs: number[] = [];
  const rel: number[] = [];
  const abs: number[] = [];
  for (const index of labeled) {
    const temp = temps[index];
    const row = rows[index];
    if (temp == null || !row || row.rel["1Y"] == null || row.abs["1Y"] == null) continue;
    xs.push(temp);
    rel.push(row.rel["1Y"]);
    abs.push(row.abs["1Y"]);
  }
  const rhoRel = spearman(xs, rel);
  const rhoAbs = spearman(xs, abs);
  const month = monthEndIndices(rows, indices);
  const monthScore = scoreAt(rows, temps, month);
  return {
    start: dates[0] ?? null,
    end: dates[dates.length - 1] ?? null,
    n: indices.length,
    labeled1y: labeled.length,
    score: rhoRel == null ? null : -rhoRel,
    spearmanAbs1y: rhoAbs,
    monthEndScore: monthScore,
    buckets: buckets.rows,
    bucketSpearman: buckets.spearman,
    deciles: deciles.rows,
    extremes: [{ coldMax, hotMin, byHorizon }],
    extremeGrid,
  };
}

/** Signal and its 1Y label both on or before the holdout cut. */
function strictTrainIndices(rows: readonly PreparedRow[]): number[] {
  const indices: number[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const label = row?.labelDate["1Y"];
    if (!row || !label) continue;
    if (row.date <= HOLDOUT_CUT && label <= HOLDOUT_CUT) indices.push(i);
  }
  return indices;
}

function indicesBetween(rows: readonly PreparedRow[], start: string, end: string): number[] {
  const indices: number[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const date = rows[i]?.date;
    if (date && date >= start && date <= end) indices.push(i);
  }
  return indices;
}

function candidateById(id: string): TemperatureCandidate | null {
  return temperatureCandidates().find((candidate) => candidate.id === id) ?? null;
}

function emptyMappingScores(): UniverseStudy["mappingScores"] {
  return {
    quantile: { meanTestScore: null, frozenTestScore: null, folds: 0 },
    zscore: { meanTestScore: null, frozenTestScore: null, folds: 0 },
    rule: { meanTestScore: null, frozenTestScore: null, folds: 0 },
  };
}

/**
 * Walk-forward on the common sample (every mapping defined).
 * Each mapping freezes the modal train choice among folds whose test year is
 * 2018 or earlier. The mapping score is that frozen model's mean score on
 * those same test folds, not the score of a model that retunes every year.
 * Q is preferred inside the epsilon band. 2019+ is reported once and is not an input.
 */
export function runTemperatureStudy(signalRows: readonly SignalRow[]): UniverseStudy {
  const preparedAll = prepareSignals(signalRows);
  const comparable = preparedAll.filter((row) => isComparable(row));
  const notes: string[] = [];
  const candidates = temperatureCandidates();
  const tempsById = new Map<string, (number | null)[]>();
  for (const candidate of candidates) {
    tempsById.set(
      candidate.id,
      comparable.map((row) => temperatureAt(row, candidate)),
    );
  }
  const dates = comparable.map((row) => row.date);
  const labelDates = comparable.map((row) => row.labelDate["1Y"]);
  const folds = walkForwardMasks(dates, labelDates);
  const foldChoices: FoldChoice[] = [];
  for (const fold of folds) {
    const byMapping = {} as FoldChoice["byMapping"];
    for (const mapping of MAPPINGS) {
      const pool = candidates.filter((candidate) => candidate.mapping === mapping);
      const chosen = bestCandidateId(pool, tempsById, comparable, fold.train);
      const testScore = chosen
        ? scoreAt(comparable, tempsById.get(chosen.id) ?? [], fold.test)
        : null;
      byMapping[mapping] = {
        candidateId: chosen?.id ?? "",
        trainScore: chosen?.score ?? Number.NaN,
        testScore,
      };
    }
    const trainStart = comparable[fold.train[0] ?? 0]?.date ?? "";
    const trainEnd = comparable[fold.train[fold.train.length - 1] ?? 0]?.date ?? "";
    const testStart = comparable[fold.test[0] ?? 0]?.date ?? "";
    const testEnd = comparable[fold.test[fold.test.length - 1] ?? 0]?.date ?? "";
    foldChoices.push({
      testYear: fold.testYear,
      trainN: fold.train.length,
      testN: fold.test.length,
      trainStart,
      trainEnd,
      testStart,
      testEnd,
      byMapping,
    });
  }

  const selectionFolds = foldChoices.filter((fold) => fold.testYear <= 2018);
  const scoredFolds = selectionFolds.length > 0 ? selectionFolds : foldChoices;
  if (selectionFolds.length === 0) {
    notes.push("No pre-2019 walk-forward fold met the sample floor; mapping uses every fold.");
  }
  const pre2019Indices = strictTrainIndices(comparable);
  const selectionMasks = folds.filter((fold) =>
    scoredFolds.some((choice) => choice.testYear === fold.testYear),
  );
  const mappingScores = emptyMappingScores();
  const frozenCandidates = {} as Record<TemperatureMapping, TemperatureCandidate>;
  for (const mapping of MAPPINGS) {
    const pool = candidates.filter((item) => item.mapping === mapping);
    const longMapping = bestCandidateId(pool, tempsById, comparable, pre2019Indices);
    const mappingModal = modalId(
      selectionFolds
        .map((fold) => fold.byMapping[mapping].candidateId)
        .filter((id) => id.length > 0),
      longMapping?.id ?? null,
    );
    const frozen = candidateById(mappingModal ?? longMapping?.id ?? "") ?? pool[0] ?? candidates[0];
    if (!frozen) throw new Error("temperature candidate grid is empty");
    frozenCandidates[mapping] = frozen;
    const temps = tempsById.get(frozen.id) ?? [];
    const frozenTests = selectionMasks
      .map((fold) => scoreAt(comparable, temps, fold.test))
      .filter((score): score is number => score != null && Number.isFinite(score));
    const retuned = scoredFolds
      .map((fold) => fold.byMapping[mapping].testScore)
      .filter((score): score is number => score != null && Number.isFinite(score));
    mappingScores[mapping] = {
      meanTestScore: mean(retuned),
      frozenTestScore: mean(frozenTests),
      folds: frozenTests.length,
    };
  }
  const chosenMapping = chooseMapping({
    quantile: mappingScores.quantile.frozenTestScore ?? Number.NEGATIVE_INFINITY,
    zscore: mappingScores.zscore.frozenTestScore ?? Number.NEGATIVE_INFINITY,
    rule: mappingScores.rule.frozenTestScore ?? Number.NEGATIVE_INFINITY,
  });
  const candidate = frozenCandidates[chosenMapping];
  if (!candidate) throw new Error("temperature candidate grid is empty");
  const longChoiceId =
    bestCandidateId(
      candidates.filter((item) => item.mapping === chosenMapping),
      tempsById,
      comparable,
      pre2019Indices,
    )?.id ?? null;
  if (longChoiceId && longChoiceId !== candidate.id) {
    notes.push(
      `Walk-forward mode is ${candidate.id}; the single pre-2019 window preferred ${longChoiceId}. Shipping the mode.`,
    );
  }

  const shippedTemps = tempsById.get(candidate.id) ?? comparable.map(() => null);
  const extremes = selectExtremeThresholds(
    shippedTemps,
    comparable.map((row) => row.rel["1Y"]),
    pre2019Indices,
  );
  if (!extremes.qualified) {
    notes.push(
      "Pre-2019 extreme zones did not reach 30 one-year outcomes on both sides; keeping 1–10 / 90–100.",
    );
  }
  const voteYears = new Set(scoredFolds.map((fold) => fold.testYear));
  const extremeVotes = folds
    .filter((fold) => voteYears.has(fold.testYear))
    .map((fold) => {
      const choice = foldChoices.find((item) => item.testYear === fold.testYear);
      const id = choice?.byMapping[chosenMapping].candidateId ?? "";
      const temps = tempsById.get(id);
      if (!temps) return "10/90";
      const foldExtremes = selectExtremeThresholds(
        temps,
        comparable.map((row) => row.rel["1Y"]),
        fold.train,
      );
      return `${foldExtremes.coldMax}/${foldExtremes.hotMin}`;
    });

  const ownTemps = shippedTemps;
  const inSample = reportWindow(
    comparable,
    ownTemps,
    indicesBetween(comparable, "1900-01-01", HOLDOUT_CUT),
    extremes.coldMax,
    extremes.hotMin,
  );
  const outOfSample = reportWindow(
    comparable,
    ownTemps,
    indicesBetween(comparable, HOLDOUT_START, "2999-12-31"),
    extremes.coldMax,
    extremes.hotMin,
  );
  const pas = comparable.map((row) => row.pa);
  const pbs = comparable.map((row) => row.pb);
  const oosIndices = indicesBetween(comparable, HOLDOUT_START, "2999-12-31");
  const mappingHoldout = {} as UniverseStudy["mappingHoldout"];
  for (const mapping of MAPPINGS) {
    const pool = candidates.filter((item) => item.mapping === mapping);
    const longMapping = bestCandidateId(pool, tempsById, comparable, pre2019Indices);
    const mappingModal = modalId(
      selectionFolds
        .map((fold) => fold.byMapping[mapping].candidateId)
        .filter((id) => id.length > 0),
      longMapping?.id ?? null,
    );
    const frozen = candidateById(mappingModal ?? longMapping?.id ?? "") ?? pool[0] ?? candidate;
    const temps = tempsById.get(frozen.id) ?? comparable.map(() => null);
    const mappingExtremes = selectExtremeThresholds(
      temps,
      comparable.map((row) => row.rel["1Y"]),
      pre2019Indices,
    );
    mappingHoldout[mapping] = {
      candidate: frozen,
      trainScore: scoreAt(comparable, temps, pre2019Indices),
      outOfSample: reportWindow(
        comparable,
        temps,
        oosIndices,
        mappingExtremes.coldMax,
        mappingExtremes.hotMin,
      ),
    };
  }

  return {
    comparableStart: comparable[0]?.date ?? null,
    comparableEnd: comparable[comparable.length - 1]?.date ?? null,
    comparableN: comparable.length,
    paPbPearson: pearson(pas, pbs),
    folds: foldChoices,
    mappingScores,
    mappingHoldout,
    chosenMapping,
    candidate,
    longWindowCandidateId: longChoiceId,
    extremes,
    extremeVotes,
    notes,
    ownHoldout: {
      inSample,
      outOfSample,
      trainScore: scoreAt(comparable, ownTemps, pre2019Indices),
    },
  };
}

/** Bucket tables for one frozen candidate. Used to apply the primary choice to the other legs. */
export function evaluateFrozen(
  signalRows: readonly SignalRow[],
  candidate: TemperatureCandidate,
  extremes: { coldMax: number; hotMin: number },
): {
  comparableN: number;
  inSample: WindowReport;
  outOfSample: WindowReport;
  score: number | null;
} {
  const comparable = prepareSignals(signalRows).filter((row) => isComparable(row));
  const temps = comparable.map((row) => temperatureAt(row, candidate));
  const labeled = strictTrainIndices(comparable);
  return {
    comparableN: comparable.length,
    inSample: reportWindow(
      comparable,
      temps,
      indicesBetween(comparable, "1900-01-01", HOLDOUT_CUT),
      extremes.coldMax,
      extremes.hotMin,
    ),
    outOfSample: reportWindow(
      comparable,
      temps,
      indicesBetween(comparable, HOLDOUT_START, "2999-12-31"),
      extremes.coldMax,
      extremes.hotMin,
    ),
    score: scoreAt(comparable, temps, labeled),
  };
}
