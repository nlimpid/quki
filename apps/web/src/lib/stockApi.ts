import type {
  DividendYears,
  StockDetailResponse,
  StockListItem,
  StockListQuery,
  StockListResponse,
  StockMarketFilter,
  StockSort,
} from "@quki/types";

async function read<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | (T & { message?: string; error?: string })
    | null;
  if (!response.ok || !body) {
    throw new Error(body?.message || body?.error || `加载失败（${response.status}）`);
  }
  return body;
}

export function fetchStockList(query: StockListQuery): Promise<StockListResponse> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.market && query.market !== "ALL") params.set("market", query.market);
  if (query.sort && query.sort !== "code") params.set("sort", query.sort);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  const suffix = params.toString();
  return fetch(`/api/stocks${suffix ? `?${suffix}` : ""}`).then((response) =>
    read<StockListResponse>(response),
  );
}

export function fetchStock(code: string, years: DividendYears): Promise<StockDetailResponse> {
  const params = new URLSearchParams();
  if (years !== "10") params.set("years", years);
  const suffix = params.toString();
  return fetch(`/api/stocks/${encodeURIComponent(code)}${suffix ? `?${suffix}` : ""}`).then(
    (response) => read<StockDetailResponse>(response),
  );
}

export function fetchStockBatch(codes: readonly string[]): Promise<{
  items: StockListItem[];
  isSample: boolean;
}> {
  const params = new URLSearchParams({ codes: codes.join(",") });
  return fetch(`/api/stocks/batch?${params.toString()}`).then((response) =>
    read<{ items: StockListItem[]; isSample: boolean }>(response),
  );
}

export function parseMarket(value: string | null): StockMarketFilter {
  if (value === "SH" || value === "SZ" || value === "BJ") return value;
  return "ALL";
}

export function parseSort(value: string | null): StockSort {
  if (value === "yield" || value === "lastDivDate") return value;
  return "code";
}

export function parseYears(value: string | null): DividendYears {
  if (value === "5" || value === "10" || value === "MAX") return value;
  return "10";
}
