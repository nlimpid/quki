import type { DailyBar } from "@quki/types";

export type WeeklyBar = {
  /** Last trading session in the ISO week (Friday when that session exists). */
  date: string;
  /** Calendar Friday of the Monday–Sunday week. */
  weekFriday: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  /** Min of per-day `low ?? close`. Used by the significant-low rule. */
  effectiveLow: number;
  effectiveHigh: number;
  volume: number | null;
  amount: number | null;
  sessions: number;
  closeOnly: boolean;
  possiblyOpen: boolean;
};

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Friday of the Monday–Sunday week that contains `iso`. */
export function weekFriday(iso: string): string {
  const date = utcDate(iso);
  const day = date.getUTCDay();
  const delta = day === 0 ? -2 : 5 - day;
  date.setUTCDate(date.getUTCDate() + delta);
  return isoDate(date);
}

export function isoWeekKey(iso: string): string {
  const date = utcDate(iso);
  const dayNum = date.getUTCDay() || 7;
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Build weekly bars from daily sessions.
 * Week identity is the ISO week (Monday start). `trade_date` is the last
 * session in that week, which is Friday whenever Friday traded.
 * Missing low/high/open fall back to that day's close for the signal path
 * only; stored OHLC stays null when the whole week is close-only.
 */
export function toWeeklyBars(daily: readonly DailyBar[], asOf?: string): WeeklyBar[] {
  const sorted = [...daily].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const groups = new Map<string, DailyBar[]>();
  for (const bar of sorted) {
    const key = isoWeekKey(bar.date);
    const list = groups.get(key);
    if (list) list.push(bar);
    else groups.set(key, [bar]);
  }

  const lastDate = asOf ?? sorted[sorted.length - 1]?.date;
  const weeks: WeeklyBar[] = [];
  for (const days of groups.values()) {
    const first = days[0];
    const last = days[days.length - 1];
    if (!first || !last) continue;
    const open = days.find((day) => day.open != null)?.open ?? null;
    const highs = days.flatMap((day) => (day.high == null ? [] : [day.high]));
    const lows = days.flatMap((day) => (day.low == null ? [] : [day.low]));
    const high = highs.length > 0 ? Math.max(...highs) : null;
    const low = lows.length > 0 ? Math.min(...lows) : null;
    const effectiveLows = days.map((day) => day.low ?? day.close);
    const effectiveHighs = days.map((day) => day.high ?? day.close);
    const volumes = days.flatMap((day) => (day.volume == null ? [] : [day.volume]));
    const amounts = days.flatMap((day) => (day.amount == null ? [] : [day.amount]));
    const friday = weekFriday(last.date);
    const isLastWeek = lastDate != null && last.date === sorted[sorted.length - 1]?.date;
    weeks.push({
      date: last.date,
      weekFriday: friday,
      open,
      high,
      low,
      close: last.close,
      effectiveLow: Math.min(...effectiveLows),
      effectiveHigh: Math.max(...effectiveHighs),
      volume: volumes.length > 0 ? volumes.reduce((sum, value) => sum + value, 0) : null,
      amount: amounts.length > 0 ? amounts.reduce((sum, value) => sum + value, 0) : null,
      sessions: days.length,
      closeOnly: open == null && high == null && low == null,
      possiblyOpen: Boolean(isLastWeek && lastDate != null && lastDate < friday),
    });
  }
  return weeks;
}
