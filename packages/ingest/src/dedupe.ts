import type { SeedBar } from "./csv.js";

function completeness(bar: SeedBar): number {
  return (
    (bar.open != null ? 1 : 0) +
    (bar.high != null ? 1 : 0) +
    (bar.low != null ? 1 : 0) +
    (bar.volume != null && bar.volume !== "0" ? 1 : 0)
  );
}

/** One row per date. Prefer the row with real OHLC over a close-only clone. */
export function dedupeBars(bars: readonly SeedBar[]): SeedBar[] {
  const byDate = new Map<string, SeedBar>();
  for (const bar of bars) {
    const prev = byDate.get(bar.date);
    if (!prev || completeness(bar) >= completeness(prev)) byDate.set(bar.date, bar);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function samePrint(a: SeedBar, b: SeedBar): boolean {
  return (
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.volume === b.volume &&
    a.amount === b.amount
  );
}

/**
 * CSIndex `index-perf` can emit a phantom row dated on the requested startDate
 * when that day is not a session, cloning the next real bar. Drop it only when
 * that start date is not already stored (incremental runs start on a real
 * session and must keep it).
 */
/**
 * 930903 / H20903 publish 1999-12-31 as an exact clone of 2005-01-04.
 * Real daily history starts 2005-01-04. Drop the anchor wherever it appears.
 */
export function dropClonedBaseRows(bars: readonly SeedBar[]): SeedBar[] {
  return bars.filter((bar) => {
    if (bar.date !== "1999-12-31") return true;
    return !bars.some((other) => other.date !== bar.date && samePrint(bar, other));
  });
}

export function dropPhantomStartRow(
  bars: readonly SeedBar[],
  startDate: string,
  startAlreadyStored: boolean,
): SeedBar[] {
  if (startAlreadyStored || bars.length < 2) return [...bars];
  const first = bars[0];
  const second = bars[1];
  if (!first || !second) return [...bars];
  if (first.date === startDate && samePrint(first, second)) return bars.slice(1);
  return [...bars];
}
