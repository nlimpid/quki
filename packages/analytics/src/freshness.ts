import { shanghaiDate } from "./dividendYield.js";

/**
 * Shanghai/Shenzhen is closed on these dates in 2026.
 * Source: 上证公告〔2025〕45号 (2025-12-22), confirmed for Mid-Autumn and
 * National Day by 上证公告〔2026〕22号. Weekend sessions are not opened.
 * https://www.sse.com.cn/disclosure/dealinstruc/closed/
 */
export const SSE_CLOSED_DATES_2026: readonly string[] = [
  "2026-01-01",
  "2026-01-02",
  "2026-02-15",
  "2026-02-16",
  "2026-02-17",
  "2026-02-18",
  "2026-02-19",
  "2026-02-20",
  "2026-02-21",
  "2026-02-22",
  "2026-02-23",
  "2026-04-04",
  "2026-04-05",
  "2026-04-06",
  "2026-05-01",
  "2026-05-02",
  "2026-05-03",
  "2026-05-04",
  "2026-05-05",
  "2026-06-19",
  "2026-06-20",
  "2026-06-21",
  "2026-09-25",
  "2026-09-26",
  "2026-09-27",
  "2026-10-01",
  "2026-10-02",
  "2026-10-03",
  "2026-10-04",
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
];

const CLOSED_2026 = new Set(SSE_CLOSED_DATES_2026);
const KNOWN_CALENDAR_YEARS = new Set([2026]);

/** 18:30 Asia/Shanghai. The 18:00 UTC+8 retry has finished by then on observed runs. */
export const CRAWL_READY_MINUTES = 18 * 60 + 30;

export type CrawlSuccess = {
  job: string;
  at: string;
};

export type MarketFreshness = {
  /** MAX(companies.updated_at) for listed SH/SZ names. Same clock as the stock list. */
  asOf: string | null;
  expectedSession: string;
  /** Earliest latest daily bar among active CSIndex instruments. */
  indexThrough: string | null;
  lastSuccess: CrawlSuccess | null;
  quotesStale: boolean;
  indexStale: boolean;
  stale: boolean;
  /** False when the session year is outside the checked-in SSE closure list. */
  calendarKnown: boolean;
};

export function isShanghaiTradingDay(isoDate: string): boolean {
  const weekday = new Date(`${isoDate}T12:00:00+08:00`).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const year = Number(isoDate.slice(0, 4));
  if (year === 2026 && CLOSED_2026.has(isoDate)) return false;
  return true;
}

export function previousTradingDay(isoDate: string): string {
  let cursor = isoDate;
  for (let i = 0; i < 21; i += 1) {
    cursor = addDays(cursor, -1);
    if (isShanghaiTradingDay(cursor)) return cursor;
  }
  throw new Error(`no trading day within 21 days before ${isoDate}`);
}

export function shanghaiClock(now: Date): { date: string; minutes: number } {
  const bag: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  const hour = Number(bag.hour);
  return {
    date: `${bag.year}-${bag.month}-${bag.day}`,
    minutes: (hour === 24 ? 0 : hour) * 60 + Number(bag.minute),
  };
}

/** Session the weekday crawl should already have written. */
export function expectedTradingSession(now: Date): string {
  const clock = shanghaiClock(now);
  if (isShanghaiTradingDay(clock.date) && clock.minutes >= CRAWL_READY_MINUTES) return clock.date;
  return previousTradingDay(clock.date);
}

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`bad date ${isoDate}`);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function sessionOf(asOf: string | null): string | null {
  if (!asOf) return null;
  const parsed = new Date(asOf);
  if (Number.isNaN(parsed.getTime())) return null;
  return shanghaiDate(parsed);
}

export function assessFreshness(input: {
  now: Date;
  asOf: string | null;
  indexThrough: string | null;
  indexIncomplete: boolean;
  lastSuccess?: CrawlSuccess | null;
}): MarketFreshness {
  const expectedSession = expectedTradingSession(input.now);
  const quotesSession = sessionOf(input.asOf);
  const quotesStale = quotesSession == null || quotesSession < expectedSession;
  const indexStale =
    input.indexIncomplete || input.indexThrough == null || input.indexThrough < expectedSession;
  const todayYear = Number(shanghaiClock(input.now).date.slice(0, 4));
  const sessionYear = Number(expectedSession.slice(0, 4));
  return {
    asOf: input.asOf,
    expectedSession,
    indexThrough: input.indexThrough,
    lastSuccess: input.lastSuccess ?? null,
    quotesStale,
    indexStale,
    stale: quotesStale || indexStale,
    calendarKnown: KNOWN_CALENDAR_YEARS.has(todayYear) && KNOWN_CALENDAR_YEARS.has(sessionYear),
  };
}
