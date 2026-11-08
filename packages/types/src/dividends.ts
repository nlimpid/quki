/** Shared A-share dividend contracts for the site API and the web app. */

export type AshareMarket = "SH" | "SZ";
export type AshareBoard = "main" | "cyb" | "kcb";
export type DividendYears = "5" | "10" | "MAX";
export type StockSort = "code" | "yield" | "lastDivDate";
export type StockMarketFilter = "ALL" | "SH" | "SZ" | "BJ";
export type DividendEventKind = "cash" | "bonus" | "transfer" | "mixed";
export type PortfolioWeight = "market" | "equal" | "partial";

export const YIELD_NOTE =
  "近12个自然月税前现金分红（每股，已按其后送转除权）÷ 最新收盘价。送转不计入分子。";

export const DIVIDEND_DISCLAIMER =
  "本站整理的上市公司分红、送转及据此估算的股息率、分红金额来源于公开信息，仅供学习与研究参考，不构成投资建议或收益承诺。现金分红展示一般为税前口径；实际到账受税制、持有期与券商结算影响。持仓与股数默认仅保存在您的设备本地。数据可能延迟或遗漏，请以交易所、上市公司公告及交易通道披露为准。";

export type StockListQuery = {
  q?: string;
  market?: StockMarketFilter;
  sort?: StockSort;
  page?: number;
  pageSize?: number;
};

export type StockListItem = {
  code: string;
  name: string;
  exchange: AshareMarket;
  board: AshareBoard;
  lastClose: number | null;
  quoteFresh: boolean;
  trailingYieldPct: number | null;
  ttmCashPerShare: number | null;
  lastCashDivDate: string | null;
  lastCashPer10: number | null;
};

export type StockListResponse = {
  asOf: string | null;
  total: number;
  page: number;
  pageSize: number;
  isSample: boolean;
  yieldNote: string;
  items: StockListItem[];
};

export type DividendEventDto = {
  id: string;
  code: string;
  eventType: DividendEventKind;
  reportDate: string | null;
  noticeDate: string | null;
  recordDate: string | null;
  exDate: string | null;
  payDate: string | null;
  cashPer10: number | null;
  bonusPer10: number | null;
  transferPer10: number | null;
  /** Pretax cash per current share after later bonus/transfer. Null when the row has no cash. */
  adjustedCashPerShare: number | null;
  profile: string | null;
};

export type StockDetailResponse = {
  company: StockListItem & { secucode: string };
  asOf: string | null;
  yieldAsOf: string | null;
  years: DividendYears;
  isSample: boolean;
  yieldNote: string;
  events: DividendEventDto[];
};
