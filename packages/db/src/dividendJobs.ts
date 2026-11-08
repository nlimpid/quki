import { addCalendarDays, shanghaiDate } from "@quki/analytics";
import {
  CASH_PER_10_TOLERANCE,
  SINA_PAGE_SIZE,
  compareGoldenSample,
  fetchEastmoneyDividendPage,
  fetchSinaCount,
  fetchSinaPage,
  pageNoticeDates,
  selectImplementedDividend,
  selectListedCompany,
  shouldStopIncremental,
  type FetchLike,
  type NormalizedDividend,
} from "@quki/ingest";

import type { SqlConn } from "./client.js";
import { emptyInvariantStats, type DividendInvariantStats } from "./dividendInvariants.js";
import {
  insertDividendCrawlRun,
  markUnseenCompaniesDelisted,
  maxNoticeDate,
  readDividendWatermark,
  recomputeDividendSummaries,
  upsertCompanies,
  upsertDividendEvents,
  writeDividendWatermark,
  type DividendQualitySummary,
} from "./dividendStore.js";

export const MIN_LISTED_UNIVERSE = 1000;
export const DIVIDEND_INCREMENTAL_OVERLAP_DAYS = 14;
export const MAX_EM_PAGES = 400;
export const MAX_SINA_PAGES = 80;

export type DividendCrawlMode = "incremental" | "backfill";

export type DividendCrawlPlan =
  | { kind: "backfill"; startPage: number }
  | { kind: "incremental"; noticeDate: string };

export function shouldMarkMissingDelisted(listedCount: number): boolean {
  return listedCount >= MIN_LISTED_UNIVERSE;
}

export function parseDividendWatermark(
  value: string | null,
): DividendCrawlPlan | { kind: "empty" } {
  if (!value) return { kind: "empty" };
  if (value.startsWith("backfill:")) {
    const page = Number(value.slice("backfill:".length));
    if (Number.isInteger(page) && page >= 1) return { kind: "backfill", startPage: page };
    return { kind: "empty" };
  }
  if (value.startsWith("notice:")) {
    const noticeDate = value.slice("notice:".length);
    if (/^\d{4}-\d{2}-\d{2}$/.test(noticeDate)) return { kind: "incremental", noticeDate };
  }
  return { kind: "empty" };
}

/**
 * First run (no watermark) and an explicit backfill walk every Eastmoney page.
 * A `backfill:N` watermark resumes at that page after a timeout.
 * Otherwise the daily job reads NOTICE_DATE descending and stops 14 days behind the watermark.
 */
export function resolveDividendCrawl(
  mode: DividendCrawlMode,
  watermark: string | null,
): DividendCrawlPlan {
  const parsed = parseDividendWatermark(watermark);
  if (parsed.kind === "backfill") return parsed;
  if (mode === "backfill" || parsed.kind === "empty") return { kind: "backfill", startPage: 1 };
  return parsed;
}

function sqlNow(now: Date): string {
  return now.toISOString().replace("T", " ").replace("Z", "");
}

async function pause(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshCompanies(
  conn: SqlConn,
  fetchImpl: FetchLike,
  sleepMs: number,
  now: Date,
): Promise<number> {
  const count = await fetchSinaCount(fetchImpl);
  const pages = Math.min(MAX_SINA_PAGES, Math.max(1, Math.ceil(count / SINA_PAGE_SIZE)));
  const seen = new Map<string, ReturnType<typeof selectListedCompany>>();
  for (let page = 1; page <= pages; page += 1) {
    const rows = await fetchSinaPage(page, fetchImpl);
    if (rows.length === 0) break;
    for (const row of rows) {
      const company = selectListedCompany(row);
      if (company) seen.set(company.code, company);
    }
    if (rows.length < SINA_PAGE_SIZE) break;
    await pause(sleepMs);
  }
  const companies = [...seen.values()].filter((company) => company != null);
  if (companies.length === 0) {
    throw new Error("Sina hs_a returned no Shanghai/Shenzhen companies");
  }
  await upsertCompanies(conn, companies, now.getTime(), sqlNow(now));
  if (shouldMarkMissingDelisted(companies.length)) {
    await markUnseenCompaniesDelisted(conn, now.getTime());
  } else {
    console.error(
      `skip delist mark: ${companies.length} SH/SZ names is below ${MIN_LISTED_UNIVERSE}`,
    );
  }
  return companies.length;
}

type CrawlProgress = DividendInvariantStats & {
  events: number;
  latencyMs: number;
  seen: NormalizedDividend[];
};

async function timedEastmoneyPage(page: number, fetchImpl: FetchLike, progress: CrawlProgress) {
  const started = Date.now();
  try {
    return await fetchEastmoneyDividendPage(page, fetchImpl);
  } finally {
    progress.latencyMs += Date.now() - started;
  }
}

function qualitySummary(
  mode: DividendQualitySummary["mode"],
  progress: CrawlProgress,
): DividendQualitySummary {
  return {
    version: 1,
    mode,
    invariantFailures: progress.skipped,
    invariantChecks: progress.byCheck,
    eventsUpserted: progress.events,
    reconcileSample: compareGoldenSample(progress.seen),
    sourceLatencyMs: progress.latencyMs,
    tolerances: {
      cashPer10: CASH_PER_10_TOLERANCE,
      equityRecordDate: 0,
      exDividendDate: 0,
    },
  };
}

async function recordQuality(
  conn: SqlConn,
  status: "success" | "partial" | "failed",
  mode: DividendQualitySummary["mode"],
  progress: CrawlProgress,
  error?: string,
): Promise<void> {
  const watermark = await readDividendWatermark(conn).catch(() => null);
  await insertDividendCrawlRun(conn, {
    status,
    rows: progress.events,
    watermark,
    quality: qualitySummary(mode, progress),
    error,
  });
}

async function crawlBackfill(
  conn: SqlConn,
  startPage: number,
  fetchImpl: FetchLike,
  sleepMs: number,
  now: Date,
  asOf: string,
  progress: CrawlProgress,
): Promise<void> {
  let page = startPage;
  let pages = startPage;
  while (page <= pages && page <= MAX_EM_PAGES) {
    const parsed = await timedEastmoneyPage(page, fetchImpl, progress);
    pages = Math.min(parsed.pages, MAX_EM_PAGES);
    const events = parsed.rows.flatMap((row) => {
      const event = selectImplementedDividend(row);
      return event ? [event] : [];
    });
    progress.seen.push(...events);
    progress.events += await upsertDividendEvents(conn, events, sqlNow(now), progress);
    await writeDividendWatermark(conn, `backfill:${page + 1}`);
    if (parsed.rows.length === 0) break;
    page += 1;
    if (page <= pages) await pause(sleepMs);
  }
  const notice = (await maxNoticeDate(conn)) ?? asOf;
  await writeDividendWatermark(conn, `notice:${notice}`);
}

async function crawlIncremental(
  conn: SqlConn,
  noticeDate: string,
  fetchImpl: FetchLike,
  sleepMs: number,
  now: Date,
  progress: CrawlProgress,
): Promise<void> {
  const cutoff = addCalendarDays(noticeDate, -DIVIDEND_INCREMENTAL_OVERLAP_DAYS);
  let page = 1;
  let pages = 1;
  let newest = noticeDate;
  while (page <= pages && page <= MAX_EM_PAGES) {
    const parsed = await timedEastmoneyPage(page, fetchImpl, progress);
    pages = Math.min(parsed.pages, MAX_EM_PAGES);
    const events: NormalizedDividend[] = [];
    for (const row of parsed.rows) {
      const event = selectImplementedDividend(row);
      if (!event) continue;
      events.push(event);
      if (event.noticeDate && event.noticeDate > newest) newest = event.noticeDate;
    }
    progress.seen.push(...events);
    progress.events += await upsertDividendEvents(conn, events, sqlNow(now), progress);
    if (parsed.rows.length === 0 || shouldStopIncremental(pageNoticeDates(parsed.rows), cutoff)) {
      break;
    }
    page += 1;
    if (page <= pages) await pause(sleepMs);
  }
  await writeDividendWatermark(conn, `notice:${newest}`);
}

export async function ingestDividends(
  conn: SqlConn,
  mode: DividendCrawlMode,
  options?: { fetchImpl?: FetchLike; sleepMs?: number; now?: Date },
): Promise<{ companies: number; events: number; mode: DividendCrawlPlan["kind"] }> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const sleepMs = options?.sleepMs ?? 350;
  const now = options?.now ?? new Date();
  const asOf = shanghaiDate(now);
  let companies = 0;
  try {
    companies = await refreshCompanies(conn, fetchImpl, sleepMs, now);
  } catch (error) {
    console.error(`company list failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const plan = resolveDividendCrawl(mode, await readDividendWatermark(conn));
  const progress: CrawlProgress = { ...emptyInvariantStats(), events: 0, latencyMs: 0, seen: [] };
  try {
    if (plan.kind === "backfill") {
      await crawlBackfill(conn, plan.startPage, fetchImpl, sleepMs, now, asOf, progress);
    } else {
      await crawlIncremental(conn, plan.noticeDate, fetchImpl, sleepMs, now, progress);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (progress.events > 0) {
      await recomputeDividendSummaries(conn, asOf).catch((recomputeError: unknown) => {
        console.error(
          `dividend yield recompute failed: ${recomputeError instanceof Error ? recomputeError.message : String(recomputeError)}`,
        );
      });
    }
    await recordQuality(
      conn,
      progress.events > 0 ? "partial" : "failed",
      plan.kind,
      progress,
      message,
    ).catch((logError: unknown) => {
      console.error(
        `dividend quality log failed: ${logError instanceof Error ? logError.message : String(logError)}`,
      );
    });
    throw error;
  }
  await recomputeDividendSummaries(conn, asOf);
  await recordQuality(conn, "success", plan.kind, progress).catch((logError: unknown) => {
    console.error(
      `dividend quality log failed: ${logError instanceof Error ? logError.message : String(logError)}`,
    );
  });
  const sample = compareGoldenSample(progress.seen);
  console.log(
    `dividends ${plan.kind}: companies ${companies}, events ${progress.events}, skipped ${progress.skipped}, sample ${sample.matched}/${sample.compared}, asOf ${asOf}`,
  );
  return { companies, events: progress.events, mode: plan.kind };
}
