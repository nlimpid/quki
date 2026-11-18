import { portfolioDividendSummary, type PortfolioDividendSummary } from "@quki/analytics";
import type { StockListItem } from "@quki/types";

export type PortfolioViewRow = { code: string; shares: number };

export type PortfolioViewCard = {
  code: string;
  shares: number;
  name: string;
  exchange: string;
  price: number | null;
  quoteFresh: boolean;
  yieldPct: number | null;
  ttmCashPerShare: number | null;
  annual: number | null;
  missing: boolean;
};

/** Same quote mapping the portfolio page used for browser holdings. */
export function portfolioPresentation(
  rows: readonly PortfolioViewRow[],
  quotes: readonly StockListItem[],
): { cards: PortfolioViewCard[]; summary: PortfolioDividendSummary } {
  const quotesByCode = new Map(quotes.map((item) => [item.code, item]));
  const cards = rows.map((holding) => {
    const quote = quotesByCode.get(holding.code);
    const ttm = quote?.ttmCashPerShare ?? null;
    return {
      code: holding.code,
      shares: holding.shares,
      name: quote?.name ?? holding.code,
      exchange: quote?.exchange ?? "",
      price: quote?.lastClose ?? null,
      quoteFresh: quote?.quoteFresh ?? false,
      yieldPct: quote?.trailingYieldPct ?? null,
      ttmCashPerShare: ttm,
      annual: ttm == null ? null : holding.shares * ttm,
      missing: !quote,
    };
  });
  const summary = portfolioDividendSummary(
    cards.map((card) => ({
      shares: card.shares,
      price: card.price,
      ttmCashPerShare: card.ttmCashPerShare,
      yieldPct: card.yieldPct,
    })),
  );
  return { cards, summary };
}
