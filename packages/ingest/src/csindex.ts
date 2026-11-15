import type { SeedBar } from "./csv.js";
import { dedupeBars, dropClonedBaseRows, dropPhantomStartRow } from "./dedupe.js";

/**
 * CSIndex official daily performance. No auth. Works from Cloudflare egress.
 * Do not use Eastmoney push2his — TLS fails from Cloudflare IPs.
 * See data/SOURCES.md.
 */
export const CSINDEX_PERF_URL = "https://www.csindex.com.cn/csindex-home/perf/index-perf";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type ApiRow = {
  tradeDate?: string;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  tradingVol?: number | null;
  tradingValue?: number | null;
  change?: number | null;
  changePct?: number | null;
};

function isoDate(compact: string): string {
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

function textNum(value: number | null | undefined, scale: number): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toFixed(scale);
}

export function mapCsindexRows(rows: readonly ApiRow[]): SeedBar[] {
  const bars: SeedBar[] = [];
  for (const row of rows) {
    if (!row.tradeDate || row.close == null || !Number.isFinite(row.close)) continue;
    const close = row.close;
    const preClose = row.change == null ? null : textNum(close - row.change, 6);
    bars.push({
      date: isoDate(row.tradeDate),
      open: textNum(row.open, 6),
      high: textNum(row.high, 6),
      low: textNum(row.low, 6),
      close: textNum(close, 6) ?? close.toString(),
      volume: textNum(row.tradingVol, 4),
      amount: textNum(row.tradingValue, 4),
      preClose,
      changePct: textNum(row.changePct, 6),
    });
  }
  return bars;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchCsindexDaily(options: {
  symbol: string;
  startDate: string;
  endDate: string;
  startAlreadyStored?: boolean;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<SeedBar[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const start = options.startDate.replaceAll("-", "");
  const end = options.endDate.replaceAll("-", "");
  const url = `${CSINDEX_PERF_URL}?indexCode=${encodeURIComponent(options.symbol)}&startDate=${start}&endDate=${end}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "quki-crawler",
        },
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      });
      if (!response.ok) throw new Error(`CSIndex HTTP ${response.status} for ${options.symbol}`);
      const body = (await response.json()) as { data?: ApiRow[]; code?: string; msg?: string };
      if (!Array.isArray(body.data)) {
        throw new Error(
          `CSIndex payload missing data for ${options.symbol}: ${body.msg ?? body.code}`,
        );
      }
      const mapped = dropClonedBaseRows(dedupeBars(mapCsindexRows(body.data)));
      return dropPhantomStartRow(mapped, options.startDate, options.startAlreadyStored ?? false);
    } catch (error) {
      lastError = error;
      await sleep(400 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export const csindexFetcher = {
  id: "csindex",
  fetchDaily: fetchCsindexDaily,
};
