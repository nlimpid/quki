import type { DividendEventKind, DividendYears, PortfolioWeight } from "@quki/types";

/** One implemented distribution. Amounts are source units: cash already per share, ratios per 10 shares. */
export type YieldEvent = {
  exDate: string;
  cashPerShare: number;
  bonusPer10: number;
  transferPer10: number;
};

export type TrailingCashYield = {
  ttmCashPerShare: number;
  yieldPct: number | null;
};

export type HoldingYieldInput = {
  shares: number;
  price: number | null;
  ttmCashPerShare: number | null;
  yieldPct: number | null;
};

export type PortfolioDividendSummary = {
  count: number;
  avgYieldPct: number | null;
  annualCashCny: number | null;
  weight: PortfolioWeight;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function dateParts(isoDate: string): { year: number; month: number; day: number } {
  const match = DATE_RE.exec(isoDate);
  if (!match) throw new Error(`bad date ${isoDate}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

/** Calendar-month shift. Day clamps to the end of the target month (2024-02-29 minus 12 months → 2023-02-28). */
export function addCalendarMonths(isoDate: string, months: number): string {
  const { year, month, day } = dateParts(isoDate);
  const index = month - 1 + months;
  const nextYear = year + Math.floor(index / 12);
  const nextMonth = ((index % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  const nextDay = Math.min(day, lastDay);
  return new Date(Date.UTC(nextYear, nextMonth, nextDay)).toISOString().slice(0, 10);
}

export function addCalendarDays(isoDate: string, days: number): string {
  const { year, month, day } = dateParts(isoDate);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function shanghaiDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Inclusive start of the trailing 12 calendar months ending on `asOf`. */
export function trailingWindowStart(asOf: string): string {
  return addCalendarMonths(asOf, -12);
}

export function yearsStart(asOf: string, years: DividendYears): string | null {
  if (years === "MAX") return null;
  return addCalendarMonths(asOf, years === "5" ? -60 : -120);
}

export function exDateInYears(exDate: string, asOf: string, years: DividendYears): boolean {
  const start = yearsStart(asOf, years);
  if (!start) return true;
  return exDate >= start;
}

export function dividendEventKind(input: {
  cashPer10: number;
  bonusPer10: number;
  transferPer10: number;
}): DividendEventKind {
  const cash = input.cashPer10 > 0;
  const bonus = input.bonusPer10 > 0;
  const transfer = input.transferPer10 > 0;
  const kindCount = Number(cash) + Number(bonus) + Number(transfer);
  if (kindCount > 1) return "mixed";
  if (bonus) return "bonus";
  if (transfer) return "transfer";
  return "cash";
}

/**
 * Pretax cash per share restated onto today's share count.
 * A later (or same-day) 10送B转T divides the cash by (10+B+T)/10.
 * `events` must include `event` itself so a mixed cash+bonus row adjusts its own cash.
 */
export function adjustedCashPerShare(event: YieldEvent, events: readonly YieldEvent[]): number {
  let factor = 1;
  for (const other of events) {
    if (other.exDate < event.exDate) continue;
    const add = other.bonusPer10 + other.transferPer10;
    if (add > 0) factor *= (10 + add) / 10;
  }
  if (!Number.isFinite(factor) || factor === 0) return 0;
  return event.cashPerShare / factor;
}

export function trailingCashYield(input: {
  events: readonly YieldEvent[];
  price: number | null;
  asOf: string;
}): TrailingCashYield {
  const start = trailingWindowStart(input.asOf);
  const relevant = input.events.filter(
    (event) => event.exDate >= start && event.exDate <= input.asOf,
  );
  let sum = 0;
  for (const event of relevant) {
    if (event.cashPerShare > 0) sum += adjustedCashPerShare(event, relevant);
  }
  const price = input.price;
  return {
    ttmCashPerShare: sum,
    yieldPct: price != null && price > 0 ? (sum / price) * 100 : null,
  };
}

export function latestCashDividend(
  events: readonly { exDate: string; cashPer10: number }[],
): { exDate: string; cashPer10: number } | null {
  let best: { exDate: string; cashPer10: number } | null = null;
  for (const event of events) {
    if (!(event.cashPer10 > 0)) continue;
    if (!best || event.exDate > best.exDate) best = event;
  }
  return best;
}

export function portfolioDividendSummary(
  holdings: readonly HoldingYieldInput[],
): PortfolioDividendSummary {
  const count = holdings.length;
  const knownCash = holdings.filter((holding) => holding.ttmCashPerShare != null);
  const annualCashCny =
    knownCash.length === 0
      ? null
      : knownCash.reduce(
          (sum, holding) => sum + holding.shares * (holding.ttmCashPerShare ?? 0),
          0,
        );
  const priced = holdings.filter((holding) => holding.price != null && holding.price > 0);
  if (priced.length === 0) {
    const yields = holdings
      .map((holding) => holding.yieldPct)
      .filter((value): value is number => value != null);
    const avgYieldPct =
      yields.length === 0 ? null : yields.reduce((sum, value) => sum + value, 0) / yields.length;
    return { count, avgYieldPct, annualCashCny, weight: "equal" };
  }
  const marketValue = priced.reduce(
    (sum, holding) => sum + holding.shares * (holding.price ?? 0),
    0,
  );
  const pricedCash = priced.reduce(
    (sum, holding) => sum + holding.shares * (holding.ttmCashPerShare ?? 0),
    0,
  );
  const avgYieldPct = marketValue > 0 ? (pricedCash / marketValue) * 100 : null;
  return {
    count,
    avgYieldPct,
    annualCashCny,
    weight: priced.length === holdings.length ? "market" : "partial",
  };
}
