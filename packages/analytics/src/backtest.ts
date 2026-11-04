/**
 * Phase-2 extension point. Not shown as live results.
 * A strategy reads weekly closes and the MA55 already computed by `metrics.ts`
 * and emits buy/sell legs. Persist those legs with `backtest_runs`,
 * `backtest_trades`, and `backtest_equity` (see db/migrations).
 */

export type StrategyBar = {
  date: string;
  close: number;
  ma: number | null;
};

export type StrategyTrade = {
  date: string;
  side: "buy" | "sell";
  price: number;
  reason: string;
};

export type RoundTrip = {
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  holdingWeeks: number;
  returnPct: number;
};

export type Strategy = {
  key: string;
  name: string;
  description: string;
  run: (
    bars: readonly StrategyBar[],
    params: { buyRatio: number; sellRatio: number },
  ) => StrategyTrade[];
};

/** Buy when weekly close/MA55 < buyRatio, sell when it returns to sellRatio. */
export const ma55BandStrategy: Strategy = {
  key: "ma55_band",
  name: "均线分档回归",
  description: "周收盘低于 MA55 的买入比例则买入，回到卖出比例则卖出。",
  run(bars, params) {
    const trades: StrategyTrade[] = [];
    let holding = false;
    for (const bar of bars) {
      if (bar.ma == null || bar.ma === 0) continue;
      const ratio = bar.close / bar.ma;
      if (!holding && ratio < params.buyRatio) {
        holding = true;
        trades.push({
          date: bar.date,
          side: "buy",
          price: bar.close,
          reason: `收盘/MA55 < ${params.buyRatio}`,
        });
      } else if (holding && ratio >= params.sellRatio) {
        holding = false;
        trades.push({
          date: bar.date,
          side: "sell",
          price: bar.close,
          reason: `收盘/MA55 >= ${params.sellRatio}`,
        });
      }
    }
    return trades;
  },
};

export const strategies: readonly Strategy[] = [ma55BandStrategy];

function weeksBetween(start: string, end: string): number {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / (7 * 86_400_000)));
}

export function roundTrips(trades: readonly StrategyTrade[]): RoundTrip[] {
  const trips: RoundTrip[] = [];
  let entry: StrategyTrade | undefined;
  for (const trade of trades) {
    if (trade.side === "buy") {
      entry = trade;
      continue;
    }
    if (trade.side === "sell" && entry) {
      trips.push({
        entryDate: entry.date,
        exitDate: trade.date,
        entryPrice: entry.price,
        exitPrice: trade.price,
        holdingWeeks: weeksBetween(entry.date, trade.date),
        returnPct: ((trade.price - entry.price) / entry.price) * 100,
      });
      entry = undefined;
    }
  }
  return trips;
}

export function winRate(trips: readonly RoundTrip[]): number | null {
  if (trips.length === 0) return null;
  const wins = trips.filter((trip) => trip.returnPct > 0).length;
  return wins / trips.length;
}
