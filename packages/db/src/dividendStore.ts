import {
  adjustedCashPerShare,
  dividendEventKind,
  exDateInYears,
  latestCashDividend,
  publishedTrailingYield,
  shanghaiDate,
  trailingCashYield,
  trailingWindowStart,
  type YieldEvent,
} from "@quki/analytics";
import {
  EASTMONEY_DIVIDEND_SOURCE,
  dividendEventKey,
  type ListedCompany,
  type NormalizedDividend,
} from "@quki/ingest";
import {
  YIELD_NOTE,
  type AshareBoard,
  type AshareMarket,
  type DividendEventDto,
  type DividendYears,
  type StockDetailResponse,
  type StockListItem,
  type StockListQuery,
  type StockListResponse,
  type StockMarketFilter,
  type StockSort,
} from "@quki/types";

import { dateText, numOrNull, rowsOf, type SqlConn } from "./client.js";
import {
  checkDividendInvariants,
  emptyInvariantStats,
  recordInvariantFailure,
  type DividendInvariantStats,
} from "./dividendInvariants.js";

const COMPANY_CHUNK = 80;
const EVENT_CHUNK = 30;
const SUMMARY_CHUNK = 40;

const DIVIDEND_JOB = "dividends_events";
const DIVIDEND_SOURCE = "eastmoney";

function placeholders(count: number, width: number): string {
  return Array.from(
    { length: count },
    () => `(${Array.from({ length: width }, () => "?").join(", ")})`,
  ).join(", ");
}

function dateOrNull(value: unknown): string | null {
  if (value == null || value === "") return null;
  const text = dateText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function dateTimeIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)) {
    const iso = text.replace(" ", "T");
    return iso.endsWith("Z") ? iso : `${iso}Z`;
  }
  return text;
}

function asMarket(value: unknown): AshareMarket | null {
  return value === "SH" || value === "SZ" ? value : null;
}

function asBoard(value: unknown): AshareBoard {
  if (value === "main" || value === "cyb" || value === "kcb") return value;
  return "main";
}

function quoteFresh(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function companyUpsertSql(rowCount: number): string {
  return `
    INSERT INTO companies (
      code, secucode, name, market, exchange_board, listing_status, sina_symbol,
      last_close, last_close_at, quote_fresh, list_seen_gen
    ) VALUES ${placeholders(rowCount, 11)}
    ON DUPLICATE KEY UPDATE
      secucode = VALUES(secucode),
      name = VALUES(name),
      market = VALUES(market),
      exchange_board = VALUES(exchange_board),
      listing_status = 'listed',
      sina_symbol = VALUES(sina_symbol),
      last_close = IF(VALUES(quote_fresh) = 1, VALUES(last_close), last_close),
      last_close_at = IF(VALUES(quote_fresh) = 1, VALUES(last_close_at), last_close_at),
      quote_fresh = VALUES(quote_fresh),
      list_seen_gen = VALUES(list_seen_gen),
      updated_at = CURRENT_TIMESTAMP(3)
  `;
}

export function dividendUpsertSql(rowCount: number): string {
  return `
    INSERT INTO dividend_events (
      secucode, code, name, report_date, plan_notice_date, notice_date,
      equity_record_date, ex_dividend_date, assign_progress, impl_plan_profile,
      cash_div_pretax_per_10, cash_div_aftertax_per_10, cash_div_pretax_per_share,
      bonus_ratio_per_10, transfer_ratio_per_10, bonus_transfer_sum_per_10,
      currency, market_type_em, is_implemented, source, event_key, fetched_at
    ) VALUES ${placeholders(rowCount, 22)}
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      report_date = VALUES(report_date),
      plan_notice_date = VALUES(plan_notice_date),
      notice_date = VALUES(notice_date),
      equity_record_date = VALUES(equity_record_date),
      ex_dividend_date = VALUES(ex_dividend_date),
      assign_progress = VALUES(assign_progress),
      impl_plan_profile = VALUES(impl_plan_profile),
      cash_div_pretax_per_10 = VALUES(cash_div_pretax_per_10),
      cash_div_aftertax_per_10 = VALUES(cash_div_aftertax_per_10),
      cash_div_pretax_per_share = VALUES(cash_div_pretax_per_share),
      bonus_ratio_per_10 = VALUES(bonus_ratio_per_10),
      transfer_ratio_per_10 = VALUES(transfer_ratio_per_10),
      bonus_transfer_sum_per_10 = VALUES(bonus_transfer_sum_per_10),
      market_type_em = VALUES(market_type_em),
      is_implemented = VALUES(is_implemented),
      source = VALUES(source),
      fetched_at = VALUES(fetched_at),
      updated_at = CURRENT_TIMESTAMP(3)
  `;
}

export function summaryUpsertSql(rowCount: number): string {
  return `
    INSERT INTO companies (
      code, secucode, name, market, listing_status,
      ttm_cash_per_share, trailing_yield_pct, last_ex_dividend_date, last_cash_per_10, yield_as_of
    ) VALUES ${placeholders(rowCount, 10)}
    ON DUPLICATE KEY UPDATE
      ttm_cash_per_share = VALUES(ttm_cash_per_share),
      trailing_yield_pct = VALUES(trailing_yield_pct),
      last_ex_dividend_date = VALUES(last_ex_dividend_date),
      last_cash_per_10 = VALUES(last_cash_per_10),
      yield_as_of = VALUES(yield_as_of),
      updated_at = CURRENT_TIMESTAMP(3)
  `;
}

export function watermarkUpsertSql(): string {
  return `
    INSERT INTO crawl_watermarks (job_name, source, instrument_id, freq, watermark)
    VALUES (?, ?, 0, 'D', ?)
    ON DUPLICATE KEY UPDATE
      watermark = VALUES(watermark),
      updated_at = CURRENT_TIMESTAMP(3)
  `;
}

function escapeLike(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export function stockListFilter(query: {
  q?: string;
  market?: StockMarketFilter;
  sort?: StockSort;
}): { where: string; args: unknown[]; order: string } {
  const args: unknown[] = [];
  const clauses = ["listing_status = 'listed'", "market IN ('SH', 'SZ')"];
  if (query.market === "BJ") clauses.push("1 = 0");
  else if (query.market === "SH" || query.market === "SZ") {
    clauses.push("market = ?");
    args.push(query.market);
  }
  const q = query.q?.trim();
  if (q) {
    clauses.push("(code LIKE ? ESCAPE '\\\\' OR name LIKE ? ESCAPE '\\\\')");
    const pattern = escapeLike(q.slice(0, 32));
    args.push(pattern, pattern);
  }
  const order =
    query.sort === "yield"
      ? "trailing_yield_pct IS NULL, trailing_yield_pct DESC, code ASC"
      : query.sort === "lastDivDate"
        ? "last_ex_dividend_date IS NULL, last_ex_dividend_date DESC, code ASC"
        : "code ASC";
  return { where: clauses.join(" AND "), args, order };
}

function mapListItem(row: Record<string, unknown>): StockListItem | null {
  const market = asMarket(row.market);
  const code = String(row.code ?? "");
  if (!market || !/^\d{6}$/.test(code)) return null;
  return {
    code,
    name: String(row.name ?? ""),
    exchange: market,
    board: asBoard(row.exchange_board),
    lastClose: numOrNull(row.last_close),
    quoteFresh: quoteFresh(row.quote_fresh),
    trailingYieldPct: publishedTrailingYield(
      numOrNull(row.trailing_yield_pct),
      quoteFresh(row.quote_fresh),
    ),
    ttmCashPerShare: numOrNull(row.ttm_cash_per_share),
    lastCashDivDate: dateOrNull(row.last_ex_dividend_date),
    lastCashPer10: numOrNull(row.last_cash_per_10),
  };
}

export async function upsertCompanies(
  conn: SqlConn,
  companies: readonly ListedCompany[],
  seenGen: number,
  fetchedAt: string,
): Promise<number> {
  let written = 0;
  for (let offset = 0; offset < companies.length; offset += COMPANY_CHUNK) {
    const slice = companies.slice(offset, offset + COMPANY_CHUNK);
    const args: unknown[] = [];
    for (const company of slice) {
      args.push(
        company.code,
        company.secucode,
        company.name,
        company.market,
        company.board,
        "listed",
        company.sinaSymbol,
        company.quoteFresh ? company.lastClose : null,
        company.quoteFresh ? fetchedAt : null,
        company.quoteFresh ? 1 : 0,
        seenGen,
      );
    }
    await conn.execute(companyUpsertSql(slice.length), args);
    written += slice.length;
  }
  return written;
}

export async function markUnseenCompaniesDelisted(conn: SqlConn, seenGen: number): Promise<void> {
  await conn.execute(
    `UPDATE companies
     SET listing_status = 'delisted', quote_fresh = 0, updated_at = CURRENT_TIMESTAMP(3)
     WHERE listing_status = 'listed' AND list_seen_gen <> ?`,
    [seenGen],
  );
}

export async function upsertDividendEvents(
  conn: SqlConn,
  events: readonly NormalizedDividend[],
  fetchedAt: string,
  stats: DividendInvariantStats = emptyInvariantStats(),
): Promise<number> {
  const accepted: NormalizedDividend[] = [];
  for (const event of events) {
    const failures = checkDividendInvariants(event);
    if (failures.length > 0) {
      recordInvariantFailure(stats, failures);
      const names = failures.map((failure) => failure.name).join(",");
      const detail = failures.map((failure) => failure.detail).join("; ");
      console.error(
        `skip dividend invariant ${event.code}@${event.exDividendDate || "?"}: ${names} (${detail})`,
      );
      continue;
    }
    accepted.push(event);
  }
  let written = 0;
  for (let offset = 0; offset < accepted.length; offset += EVENT_CHUNK) {
    const slice = accepted.slice(offset, offset + EVENT_CHUNK);
    const keys = await Promise.all(slice.map((event) => dividendEventKey(event)));
    const args: unknown[] = [];
    slice.forEach((event, index) => {
      args.push(
        event.secucode,
        event.code,
        event.name || null,
        event.reportDate,
        event.planNoticeDate,
        event.noticeDate,
        event.equityRecordDate,
        event.exDividendDate,
        event.assignProgress,
        event.implPlanProfile,
        event.cashPer10,
        event.cashAfterTaxPer10,
        event.cashPerShare,
        event.bonusPer10,
        event.transferPer10,
        event.bonusTransferSumPer10,
        "CNY",
        event.marketTypeEm,
        1,
        EASTMONEY_DIVIDEND_SOURCE,
        keys[index],
        fetchedAt,
      );
    });
    await conn.execute(dividendUpsertSql(slice.length), args);
    written += slice.length;
  }
  return written;
}

export async function readDividendWatermark(conn: SqlConn): Promise<string | null> {
  const result = await conn.execute(
    `SELECT watermark FROM crawl_watermarks
     WHERE job_name = ? AND source = ? AND instrument_id = 0 AND freq = 'D'
     LIMIT 1`,
    [DIVIDEND_JOB, DIVIDEND_SOURCE],
  );
  const watermark = rowsOf(result)[0]?.watermark;
  return watermark == null ? null : String(watermark);
}

export async function writeDividendWatermark(conn: SqlConn, watermark: string): Promise<void> {
  await conn.execute(watermarkUpsertSql(), [DIVIDEND_JOB, DIVIDEND_SOURCE, watermark]);
}

export async function maxNoticeDate(conn: SqlConn): Promise<string | null> {
  const result = await conn.execute("SELECT MAX(notice_date) AS notice_date FROM dividend_events");
  return dateOrNull(rowsOf(result)[0]?.notice_date);
}

type SummarySeed = {
  code: string;
  secucode: string;
  name: string;
  market: AshareMarket;
  price: number | null;
  quoteFresh: boolean;
};

export type DividendQualitySummary = {
  version: 1;
  mode: "incremental" | "backfill";
  invariantFailures: number;
  invariantChecks: Record<string, number>;
  eventsUpserted: number;
  reconcileSample: { compared: number; matched: number; passRate: number | null };
  sourceLatencyMs: number;
  tolerances: { cashPer10: number; equityRecordDate: 0; exDividendDate: 0 };
};

export async function insertDividendCrawlRun(
  conn: SqlConn,
  input: {
    status: "success" | "partial" | "failed";
    rows: number;
    watermark: string | null;
    quality: DividendQualitySummary;
    error?: string;
  },
): Promise<void> {
  await conn.execute(
    `INSERT INTO crawl_runs (
       job_name, source, instrument_id, freq, status, rows_upserted,
       cursor_watermark, request_meta, error_message, finished_at
     ) VALUES (?, 'eastmoney', NULL, 'D', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [
      "dividends_events",
      input.status,
      input.rows,
      input.watermark,
      JSON.stringify(input.quality),
      input.error ?? null,
    ],
  );
}

function yieldEventFrom(row: Record<string, unknown>): (YieldEvent & { code: string }) | null {
  const code = String(row.code ?? "");
  const exDate = dateOrNull(row.ex_dividend_date);
  if (!code || !exDate) return null;
  return {
    code,
    exDate,
    cashPerShare: numOrNull(row.cash_div_pretax_per_share) ?? 0,
    bonusPer10: numOrNull(row.bonus_ratio_per_10) ?? 0,
    transferPer10: numOrNull(row.transfer_ratio_per_10) ?? 0,
  };
}

export async function recomputeDividendSummaries(conn: SqlConn, asOf: string): Promise<number> {
  const companies = rowsOf(
    await conn.execute(
      `SELECT code, secucode, name, market, last_close, quote_fresh
       FROM companies
       WHERE listing_status = 'listed' AND market IN ('SH', 'SZ')`,
    ),
  );
  const seeds: SummarySeed[] = [];
  for (const row of companies) {
    const market = asMarket(row.market);
    const code = String(row.code ?? "");
    if (!market || !/^\d{6}$/.test(code)) continue;
    seeds.push({
      code,
      secucode: String(row.secucode ?? `${code}.${market}`),
      name: String(row.name ?? code),
      market,
      price: numOrNull(row.last_close),
      quoteFresh: quoteFresh(row.quote_fresh),
    });
  }
  if (seeds.length === 0) return 0;
  const start = trailingWindowStart(asOf);
  const windowRows = rowsOf(
    await conn.execute(
      `SELECT code, ex_dividend_date, cash_div_pretax_per_share, bonus_ratio_per_10, transfer_ratio_per_10
       FROM dividend_events
       WHERE is_implemented = 1 AND ex_dividend_date >= ? AND ex_dividend_date <= ?`,
      [start, asOf],
    ),
  );
  const latestRows = rowsOf(
    await conn.execute(
      `SELECT d.code, d.ex_dividend_date, d.cash_div_pretax_per_10
       FROM dividend_events d
       INNER JOIN (
         SELECT code, MAX(ex_dividend_date) AS ex_dividend_date
         FROM dividend_events
         WHERE is_implemented = 1 AND ex_dividend_date IS NOT NULL AND cash_div_pretax_per_10 > 0
         GROUP BY code
       ) latest ON latest.code = d.code AND latest.ex_dividend_date = d.ex_dividend_date
       WHERE d.is_implemented = 1 AND d.cash_div_pretax_per_10 > 0`,
    ),
  );
  const byCode = new Map<string, YieldEvent[]>();
  for (const row of windowRows) {
    const event = yieldEventFrom(row);
    if (!event) continue;
    const list = byCode.get(event.code) ?? [];
    list.push(event);
    byCode.set(event.code, list);
  }
  const latestByCode = new Map<string, { exDate: string; cashPer10: number }>();
  for (const row of latestRows) {
    const code = String(row.code ?? "");
    const exDate = dateOrNull(row.ex_dividend_date);
    const cashPer10 = numOrNull(row.cash_div_pretax_per_10);
    if (!code || !exDate || cashPer10 == null || cashPer10 <= 0) continue;
    const current = latestByCode.get(code);
    if (
      !current ||
      exDate > current.exDate ||
      (exDate === current.exDate && cashPer10 > current.cashPer10)
    ) {
      latestByCode.set(code, { exDate, cashPer10 });
    }
  }
  let written = 0;
  for (let offset = 0; offset < seeds.length; offset += SUMMARY_CHUNK) {
    const slice = seeds.slice(offset, offset + SUMMARY_CHUNK);
    const args: unknown[] = [];
    for (const seed of slice) {
      const yieldResult = trailingCashYield({
        events: byCode.get(seed.code) ?? [],
        price: seed.price,
        asOf,
        quoteFresh: seed.quoteFresh,
      });
      const latest = latestByCode.get(seed.code) ?? null;
      args.push(
        seed.code,
        seed.secucode,
        seed.name,
        seed.market,
        "listed",
        yieldResult.ttmCashPerShare.toFixed(8),
        yieldResult.yieldPct,
        latest?.exDate ?? null,
        latest ? latest.cashPer10.toFixed(6) : null,
        asOf,
      );
    }
    await conn.execute(summaryUpsertSql(slice.length), args);
    written += slice.length;
  }
  return written;
}

async function listAsOf(conn: SqlConn): Promise<string | null> {
  const result = await conn.execute(
    `SELECT MAX(updated_at) AS updated_at
     FROM companies
     WHERE listing_status = 'listed' AND market IN ('SH', 'SZ')`,
  );
  return dateTimeIso(rowsOf(result)[0]?.updated_at);
}

export async function listStocks(conn: SqlConn, query: StockListQuery): Promise<StockListResponse> {
  const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize ?? 50)));
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const filter = stockListFilter(query);
  const totalRow = rowsOf(
    await conn.execute(
      `SELECT COUNT(*) AS total FROM companies WHERE ${filter.where}`,
      filter.args,
    ),
  )[0];
  const rows = rowsOf(
    await conn.execute(
      `SELECT code, name, market, exchange_board, last_close, quote_fresh,
              ttm_cash_per_share, trailing_yield_pct, last_ex_dividend_date, last_cash_per_10
       FROM companies
       WHERE ${filter.where}
       ORDER BY ${filter.order}
       LIMIT ? OFFSET ?`,
      [...filter.args, pageSize, (page - 1) * pageSize],
    ),
  );
  return {
    asOf: await listAsOf(conn),
    total: numOrNull(totalRow?.total) ?? 0,
    page,
    pageSize,
    isSample: false,
    yieldNote: YIELD_NOTE,
    items: rows.flatMap((row) => {
      const item = mapListItem(row);
      return item ? [item] : [];
    }),
  };
}

export async function lookupStocks(
  conn: SqlConn,
  codes: readonly string[],
): Promise<StockListItem[]> {
  const unique = [...new Set(codes.filter((code) => /^\d{6}$/.test(code)))].slice(0, 50);
  if (unique.length === 0) return [];
  const marks = unique.map(() => "?").join(", ");
  const rows = rowsOf(
    await conn.execute(
      `SELECT code, name, market, exchange_board, last_close, quote_fresh,
              ttm_cash_per_share, trailing_yield_pct, last_ex_dividend_date, last_cash_per_10
       FROM companies
       WHERE listing_status = 'listed' AND market IN ('SH', 'SZ') AND code IN (${marks})`,
      unique,
    ),
  );
  const byCode = new Map<string, StockListItem>();
  for (const row of rows) {
    const item = mapListItem(row);
    if (item) byCode.set(item.code, item);
  }
  return unique.flatMap((code) => {
    const item = byCode.get(code);
    return item ? [item] : [];
  });
}

function eventDto(
  row: Record<string, unknown>,
  event: YieldEvent | undefined,
  events: readonly YieldEvent[],
): DividendEventDto | null {
  const exDate = dateOrNull(row.ex_dividend_date);
  const code = String(row.code ?? "");
  if (!exDate || !event) return null;
  const cashPer10 = numOrNull(row.cash_div_pretax_per_10) ?? 0;
  const bonusPer10 = numOrNull(row.bonus_ratio_per_10) ?? 0;
  const transferPer10 = numOrNull(row.transfer_ratio_per_10) ?? 0;
  return {
    id: String(row.id ?? row.event_key ?? `${code}-${exDate}`),
    code,
    eventType: dividendEventKind({ cashPer10, bonusPer10, transferPer10 }),
    reportDate: dateOrNull(row.report_date),
    noticeDate: dateOrNull(row.notice_date),
    recordDate: dateOrNull(row.equity_record_date),
    exDate,
    payDate: dateOrNull(row.pay_cash_date),
    cashPer10: cashPer10 > 0 ? cashPer10 : null,
    bonusPer10: bonusPer10 > 0 ? bonusPer10 : null,
    transferPer10: transferPer10 > 0 ? transferPer10 : null,
    adjustedCashPerShare: cashPer10 > 0 ? adjustedCashPerShare(event, events) : null,
    profile: row.impl_plan_profile == null ? null : String(row.impl_plan_profile),
  };
}

export async function getStockDetail(
  conn: SqlConn,
  code: string,
  years: DividendYears,
): Promise<StockDetailResponse | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const companyRows = rowsOf(
    await conn.execute(
      `SELECT code, secucode, name, market, exchange_board, last_close, quote_fresh,
              ttm_cash_per_share, trailing_yield_pct, last_ex_dividend_date, last_cash_per_10,
              yield_as_of, updated_at
       FROM companies
       WHERE code = ? AND listing_status = 'listed' AND market IN ('SH', 'SZ')
       LIMIT 1`,
      [code],
    ),
  );
  const companyRow = companyRows[0];
  const item = companyRow ? mapListItem(companyRow) : null;
  if (!companyRow || !item) return null;
  const eventRows = rowsOf(
    await conn.execute(
      `SELECT id, event_key, code, report_date, notice_date, equity_record_date, ex_dividend_date,
              pay_cash_date, cash_div_pretax_per_10, cash_div_pretax_per_share,
              bonus_ratio_per_10, transfer_ratio_per_10, impl_plan_profile
       FROM dividend_events
       WHERE code = ? AND is_implemented = 1
       ORDER BY ex_dividend_date DESC, id DESC`,
      [code],
    ),
  );
  const pairs = eventRows.flatMap((row) => {
    const event = yieldEventFrom(row);
    return event ? [{ row, event }] : [];
  });
  const yieldEvents = pairs.map((pair) => pair.event);
  const asOfDate = dateOrNull(companyRow.yield_as_of) ?? shanghaiDate();
  const live = trailingCashYield({
    events: yieldEvents,
    price: item.lastClose,
    asOf: asOfDate,
    quoteFresh: item.quoteFresh,
  });
  const latest = latestCashDividend(
    pairs.map((pair) => ({
      exDate: pair.event.exDate,
      cashPer10: numOrNull(pair.row.cash_div_pretax_per_10) ?? 0,
    })),
  );
  const company = {
    ...item,
    secucode: String(companyRow.secucode ?? `${item.code}.${item.exchange}`),
    trailingYieldPct: publishedTrailingYield(
      item.trailingYieldPct ?? live.yieldPct,
      item.quoteFresh,
    ),
    ttmCashPerShare: item.ttmCashPerShare ?? live.ttmCashPerShare,
    lastCashDivDate: item.lastCashDivDate ?? latest?.exDate ?? null,
    lastCashPer10: item.lastCashPer10 ?? latest?.cashPer10 ?? null,
  };
  const events = pairs.flatMap((pair) => {
    if (!exDateInYears(pair.event.exDate, asOfDate, years)) return [];
    const dto = eventDto(pair.row, pair.event, yieldEvents);
    return dto ? [dto] : [];
  });
  return {
    company,
    asOf: dateTimeIso(companyRow.updated_at),
    yieldAsOf: asOfDate,
    years,
    isSample: false,
    yieldNote: YIELD_NOTE,
    events,
  };
}
