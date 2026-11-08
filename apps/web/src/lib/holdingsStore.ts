import {
  HOLDINGS_STORAGE_KEY,
  emptyHoldings,
  removeHolding,
  sanitizeHoldings,
  upsertHolding,
  type HoldingsState,
} from "@quki/analytics";

export function readHoldings(): { state: HoldingsState; error: string | null } {
  try {
    const raw = localStorage.getItem(HOLDINGS_STORAGE_KEY);
    if (!raw) return { state: emptyHoldings(), error: null };
    return { state: sanitizeHoldings(JSON.parse(raw) as unknown), error: null };
  } catch {
    return { state: emptyHoldings(), error: "本机读取失败" };
  }
}

export function writeHoldings(state: HoldingsState): void {
  localStorage.setItem(HOLDINGS_STORAGE_KEY, JSON.stringify(state));
}

export function saveHolding(code: string, shares: number): HoldingsState {
  const { state } = readHoldings();
  const next = upsertHolding(state, code, shares, new Date().toISOString());
  writeHoldings(next);
  return next;
}

export function deleteHolding(code: string): HoldingsState {
  const { state } = readHoldings();
  const next = removeHolding(state, code);
  writeHoldings(next);
  return next;
}
