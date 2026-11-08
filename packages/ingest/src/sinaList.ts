import type { FetchLike } from "./csindex.js";

export const SINA_COUNT_URL =
  "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount?node=hs_a";

export const SINA_PAGE_SIZE = 100;

export type AshareBoard = "main" | "cyb" | "kcb";

export type ListedCompany = {
  code: string;
  secucode: string;
  name: string;
  market: "SH" | "SZ";
  board: AshareBoard;
  sinaSymbol: string;
  lastClose: string | null;
  quoteFresh: boolean;
};

export function sinaPageUrl(page: number): string {
  return `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=${SINA_PAGE_SIZE}&sort=symbol&asc=1&node=hs_a`;
}

export function parseSinaCount(body: unknown): number {
  const value = typeof body === "string" ? Number(body.replaceAll('"', "").trim()) : body;
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(count) || count < 0) throw new Error("Sina hs_a count was not a number");
  return Math.floor(count);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseSinaPage(body: unknown): Record<string, unknown>[] {
  let value = body;
  if (typeof value === "string") {
    if (!value.trim() || value.trim() === "null") return [];
    value = JSON.parse(value) as unknown;
  }
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

/** Collapse fullwidth Latin and internal spaces so `万 科Ａ` becomes `万科A`. */
export function normalizeShortName(name: string): string {
  return name
    .replaceAll("\u3000", "")
    .replace(/[\uFF21-\uFF3A\uFF41-\uFF5A]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/\s+/g, "")
    .trim();
}

export function boardOf(market: "SH" | "SZ", code: string): AshareBoard {
  if (market === "SH" && (code.startsWith("688") || code.startsWith("689"))) return "kcb";
  if (market === "SZ" && (code.startsWith("300") || code.startsWith("301"))) return "cyb";
  return "main";
}

function positiveTrade(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Keep Shanghai and Shenzhen A-shares from Sina `hs_a`.
 * Drops Beijing (`bj…`), blank names, and anything that is not a 6-digit code.
 */
export function selectListedCompany(row: Record<string, unknown>): ListedCompany | null {
  const symbol = String(row.symbol ?? "")
    .trim()
    .toLowerCase();
  const code = String(row.code ?? "")
    .trim()
    .padStart(6, "0");
  if (!/^\d{6}$/.test(code)) return null;
  const market = symbol.startsWith("sh") ? "SH" : symbol.startsWith("sz") ? "SZ" : null;
  if (!market) return null;
  const name = normalizeShortName(String(row.name ?? ""));
  if (!name) return null;
  const trade = positiveTrade(row.trade);
  return {
    code,
    secucode: `${code}.${market}`,
    name,
    market,
    board: boardOf(market, code),
    sinaSymbol: symbol,
    lastClose: trade == null ? null : trade.toFixed(4),
    quoteFresh: trade != null,
  };
}

export async function fetchSinaCount(fetchImpl: FetchLike = fetch): Promise<number> {
  return parseSinaCount(await fetchJson(SINA_COUNT_URL, fetchImpl));
}

export async function fetchSinaPage(
  page: number,
  fetchImpl: FetchLike = fetch,
): Promise<Record<string, unknown>[]> {
  return parseSinaPage(await fetchJson(sinaPageUrl(page), fetchImpl));
}

async function fetchJson(url: string, fetchImpl: FetchLike): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": "Cloudflare-Workers" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Sina HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
