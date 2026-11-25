import type { SeedBar } from "./csv.js";
import { fetchCsindexDaily, type FetchLike } from "./csindex.js";

export type CsindexWindow = {
  startDate: string;
  endDate: string;
  role: "primary" | "target-day";
};

/**
 * Incremental windows only. Primary is the stored session through Shanghai
 * today. If that body does not contain the fetch target, one target-day
 * request follows. No month-start sweep and no further retries here;
 * `fetchCsindexDaily` already retries transport failures three times.
 */
export function incrementalCsindexWindows(input: {
  storedThrough: string | null;
  shanghaiToday: string;
  targetSession: string;
  baseDate: string;
}): CsindexWindow[] {
  const start = input.storedThrough ?? input.baseDate;
  const windows: CsindexWindow[] = [
    { startDate: start, endDate: input.shanghaiToday, role: "primary" },
  ];
  if (start !== input.targetSession) {
    windows.push({
      startDate: input.targetSession,
      endDate: input.targetSession,
      role: "target-day",
    });
  }
  return windows;
}

export function coversSession(bars: readonly { date: string }[], session: string): boolean {
  return bars.some((bar) => bar.date === session);
}

/**
 * Keep every bar the endpoint actually returned. Never relabel a date and
 * never invent a close. The target-day window is skipped once the primary
 * body already has that session.
 */
export async function fetchIncrementalCsindex(options: {
  symbol: string;
  windows: readonly CsindexWindow[];
  targetSession: string;
  startAlreadyStored?: boolean;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<{ bars: SeedBar[]; windowsFetched: CsindexWindow[]; covered: boolean }> {
  const collected: SeedBar[] = [];
  const windowsFetched: CsindexWindow[] = [];
  for (const window of options.windows) {
    if (window.role === "target-day" && coversSession(collected, options.targetSession)) break;
    const bars = await fetchCsindexDaily({
      symbol: options.symbol,
      startDate: window.startDate,
      endDate: window.endDate,
      startAlreadyStored: window.role === "primary" ? options.startAlreadyStored : false,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
    windowsFetched.push(window);
    for (const bar of bars) {
      if (!collected.some((kept) => kept.date === bar.date)) collected.push(bar);
    }
    if (window.role === "target-day") break;
  }
  return {
    bars: collected,
    windowsFetched,
    covered: coversSession(collected, options.targetSession),
  };
}
