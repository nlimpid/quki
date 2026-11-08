import type { FetchLike } from "./csindex.js";

export const EASTMONEY_DIVIDEND_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get";
export const EASTMONEY_DIVIDEND_SOURCE = "eastmoney:RPT_SHAREBONUS_DET";
export const EASTMONEY_PAGE_SIZE = 500;
export const IMPLEMENTED_PROGRESS = "实施分配";
/** Eastmoney MARKET_TYPE for Beijing. Prefer the `.BJ` suffix; this is a second guard. */
export const BJ_MARKET_TYPE = "069001017";

export type NormalizedDividend = {
  secucode: string;
  code: string;
  name: string;
  reportDate: string | null;
  planNoticeDate: string | null;
  noticeDate: string | null;
  equityRecordDate: string | null;
  exDividendDate: string;
  assignProgress: string;
  implPlanProfile: string;
  cashPer10: string | null;
  cashAfterTaxPer10: string | null;
  cashPerShare: string | null;
  bonusPer10: string | null;
  transferPer10: string | null;
  bonusTransferSumPer10: string | null;
  marketTypeEm: string | null;
};

export function eastmoneyDividendUrl(page: number): string {
  const params = new URLSearchParams({
    reportName: "RPT_SHAREBONUS_DET",
    columns: "ALL",
    quoteColumns: "",
    pageNumber: String(page),
    pageSize: String(EASTMONEY_PAGE_SIZE),
    sortTypes: "-1",
    sortColumns: "NOTICE_DATE",
    source: "WEB",
    client: "WEB",
  });
  return `${EASTMONEY_DIVIDEND_URL}?${params.toString()}`;
}

export function emDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value).trim());
  return match?.[1] ?? null;
}

export function parseAfterTaxPer10(profile: string): number | null {
  const match = /扣税后([0-9]+(?:\.[0-9]+)?)元/.exec(profile);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function decimal(value: number | null, scale: number): string | null {
  if (value == null || value === 0) return null;
  return value.toFixed(scale);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseEastmoneyPage(body: unknown): {
  pages: number;
  rows: Record<string, unknown>[];
} {
  if (!isRecord(body) || body.success !== true || !isRecord(body.result)) {
    const code = isRecord(body) ? String(body.code ?? "") : "";
    throw new Error(`Eastmoney dividend payload was not successful${code ? ` (${code})` : ""}`);
  }
  if (!Array.isArray(body.result.data)) throw new Error("Eastmoney dividend payload missing data");
  const pages = Number(body.result.pages);
  return {
    pages: Number.isFinite(pages) && pages > 0 ? Math.floor(pages) : 1,
    rows: body.result.data.filter(isRecord),
  };
}

/**
 * Keep one implemented Shanghai/Shenzhen distribution.
 * Drops Beijing, plans (`预披露`, `董事会决议通过`, …), rows without an ex-date,
 * and rows with no cash, bonus, or transfer.
 */
export function selectImplementedDividend(row: Record<string, unknown>): NormalizedDividend | null {
  const code = String(row.SECURITY_CODE ?? "")
    .trim()
    .padStart(6, "0");
  const secucode = String(row.SECUCODE ?? "")
    .trim()
    .toUpperCase();
  if (!/^\d{6}$/.test(code)) return null;
  if (secucode.endsWith(".BJ") || String(row.MARKET_TYPE ?? "") === BJ_MARKET_TYPE) return null;
  if (!secucode.endsWith(".SH") && !secucode.endsWith(".SZ")) return null;
  if (String(row.ASSIGN_PROGRESS ?? "") !== IMPLEMENTED_PROGRESS) return null;
  const exDividendDate = emDate(row.EX_DIVIDEND_DATE);
  if (!exDividendDate) return null;
  const cash = finiteNumber(row.PRETAX_BONUS_RMB);
  const bonus = finiteNumber(row.BONUS_RATIO);
  const transfer = finiteNumber(row.IT_RATIO);
  const has = (value: number | null) => value != null && value !== 0;
  if (!has(cash) && !has(bonus) && !has(transfer)) return null;
  const implPlanProfile = String(row.IMPL_PLAN_PROFILE ?? "");
  const afterTax = parseAfterTaxPer10(implPlanProfile);
  const sum = finiteNumber(row.BONUS_IT_RATIO);
  return {
    secucode,
    code,
    name: String(row.SECURITY_NAME_ABBR ?? "").trim(),
    reportDate: emDate(row.REPORT_DATE),
    planNoticeDate: emDate(row.PLAN_NOTICE_DATE),
    noticeDate: emDate(row.NOTICE_DATE),
    equityRecordDate: emDate(row.EQUITY_RECORD_DATE),
    exDividendDate,
    assignProgress: IMPLEMENTED_PROGRESS,
    implPlanProfile,
    cashPer10: decimal(cash, 6),
    cashAfterTaxPer10: decimal(afterTax, 6),
    cashPerShare: cash != null && cash !== 0 ? (cash / 10).toFixed(8) : null,
    bonusPer10: decimal(bonus, 6),
    transferPer10: decimal(transfer, 6),
    bonusTransferSumPer10: decimal(sum, 6),
    marketTypeEm: row.MARKET_TYPE == null ? null : String(row.MARKET_TYPE),
  };
}

export function pageNoticeDates(rows: readonly Record<string, unknown>[]): (string | null)[] {
  return rows.map((row) => emDate(row.NOTICE_DATE));
}

/** Stop the incremental walk once a NOTICE_DATE-desc page is entirely older than the overlap cutoff. */
export function shouldStopIncremental(
  noticeDates: readonly (string | null)[],
  cutoff: string,
): boolean {
  const dates = noticeDates.filter((date): date is string => !!date);
  if (dates.length === 0) return false;
  const oldest = dates.reduce((min, date) => (date < min ? date : min));
  return oldest < cutoff;
}

export async function fetchEastmoneyDividendPage(
  page: number,
  fetchImpl: FetchLike = fetch,
): Promise<{ pages: number; rows: Record<string, unknown>[] }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(eastmoneyDividendUrl(page), {
        headers: { Accept: "application/json", "User-Agent": "Cloudflare-Workers" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Eastmoney HTTP ${response.status}`);
      return parseEastmoneyPage(await response.json());
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function dividendEventKey(event: NormalizedDividend): Promise<string> {
  const payload = [
    event.secucode,
    event.reportDate ?? "",
    event.planNoticeDate ?? "",
    event.noticeDate ?? "",
    event.implPlanProfile,
    event.exDividendDate,
  ].join("\u001f");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
