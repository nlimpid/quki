/** Device holdings. The server does not store these. */

export const HOLDINGS_STORAGE_KEY = "qk.holdings.v1";
export const HOLDINGS_MAX_SHARES = 1_000_000_000;

export type HoldingRecord = {
  code: string;
  shares: number;
  updatedAt: string;
};

export type HoldingsState = {
  version: 1;
  items: HoldingRecord[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function emptyHoldings(): HoldingsState {
  return { version: 1, items: [] };
}

export function validShareCount(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > HOLDINGS_MAX_SHARES) return null;
  return parsed;
}

export function sanitizeHoldings(value: unknown): HoldingsState {
  if (!isRecord(value) || !Array.isArray(value.items)) return emptyHoldings();
  const items: HoldingRecord[] = [];
  const seen = new Set<string>();
  for (const item of value.items) {
    if (!isRecord(item)) continue;
    const code = String(item.code ?? "");
    const shares = validShareCount(item.shares);
    const updatedAt = typeof item.updatedAt === "string" ? item.updatedAt : "";
    if (!/^\d{6}$/.test(code) || shares == null || seen.has(code)) continue;
    seen.add(code);
    items.push({ code, shares, updatedAt });
  }
  return { version: 1, items };
}

export function upsertHolding(
  state: HoldingsState,
  code: string,
  shares: number,
  updatedAt: string,
): HoldingsState {
  if (!/^\d{6}$/.test(code)) throw new Error("股票代码需为 6 位数字");
  const count = validShareCount(shares);
  if (count == null) throw new Error("股数需为 1 到 10 亿之间的整数");
  const items = state.items.filter((item) => item.code !== code);
  items.push({ code, shares: count, updatedAt });
  items.sort((a, b) => a.code.localeCompare(b.code));
  return { version: 1, items };
}

export function removeHolding(state: HoldingsState, code: string): HoldingsState {
  return { version: 1, items: state.items.filter((item) => item.code !== code) };
}
