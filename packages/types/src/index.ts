/** Shared contracts. UI, workers, and the analytics package all import these. */

export const TIER_LEVELS = [85, 90, 95, 100, 105, 110, 115] as const;
export type TierLevel = (typeof TIER_LEVELS)[number];

export const TIER_LABELS: Record<TierLevel, string> = {
  85: "史诗底",
  90: "重要底",
  95: "偏低",
  100: "MA55",
  105: "偏热",
  110: "过热",
  115: "顶部区域",
};

/** Labels that are not part of the owner's 85/90 rule. */
export const DERIVED_TIER_LEVELS: readonly TierLevel[] = [95, 105, 110, 115];

export type Period = "D" | "W";
export type RangeKey = "1Y" | "3Y" | "5Y" | "10Y" | "MAX";

export type InstrumentInfo = {
  symbol: string;
  name: string;
  shortName: string;
  nameEn: string;
  twinSymbol: string;
  baseDate: string;
  isTotalReturn: boolean;
};

export const PHASE1_INSTRUMENTS: readonly InstrumentInfo[] = [
  {
    symbol: "H30269",
    name: "中证红利低波动指数",
    shortName: "红利低波",
    nameEn: "CSI Dividend Low Volatility Index",
    twinSymbol: "H20269",
    baseDate: "2005-12-30",
    isTotalReturn: false,
  },
  {
    symbol: "000922",
    name: "中证红利指数",
    shortName: "中证红利",
    nameEn: "CSI Dividend Index",
    twinSymbol: "H00922",
    baseDate: "2004-12-31",
    isTotalReturn: false,
  },
];

export const SEEDED_INSTRUMENTS: readonly InstrumentInfo[] = [
  ...PHASE1_INSTRUMENTS,
  {
    symbol: "H20269",
    name: "红利低波全收益",
    shortName: "红利低波全收益",
    nameEn: "CSI Dividend Low Volatility Total Return Index",
    twinSymbol: "H30269",
    baseDate: "2005-12-30",
    isTotalReturn: true,
  },
  {
    symbol: "H00922",
    name: "中证红利全收益",
    shortName: "中证红利全收益",
    nameEn: "CSI Dividend Total Return Index",
    twinSymbol: "000922",
    baseDate: "2004-12-31",
    isTotalReturn: true,
  },
  {
    symbol: "930903",
    name: "中证A股指数",
    shortName: "中证A股",
    nameEn: "CSI China A Share Index",
    twinSymbol: "H20903",
    baseDate: "2005-01-04",
    isTotalReturn: false,
  },
  {
    symbol: "H20903",
    name: "中证A股全收益",
    shortName: "中证A股全收益",
    nameEn: "CSI China A Share Total Return Index",
    twinSymbol: "930903",
    baseDate: "2005-01-04",
    isTotalReturn: true,
  },
  {
    symbol: "000985",
    name: "中证全指指数",
    shortName: "中证全指",
    nameEn: "CSI All Share Index",
    twinSymbol: "H00985",
    baseDate: "2004-12-31",
    isTotalReturn: false,
  },
  {
    symbol: "H00985",
    name: "中证全指全收益",
    shortName: "中证全指全收益",
    nameEn: "CSI All Share Total Return Index",
    twinSymbol: "000985",
    baseDate: "2004-12-31",
    isTotalReturn: true,
  },
];

/**
 * Explicit pairs. Defaults are total return vs total return.
 * Price vs price is offered separately so the two conventions are not mixed.
 * Append a pair (for example H20269 vs H20903) without changing the study code.
 */
export const ROTATION_PAIRS: readonly ResolvedRotationPair[] = [
  {
    id: "h00922-h20903",
    title: "红利 vs 中证A股",
    a: "H00922",
    b: "H20903",
    aName: "中证红利全收益",
    bName: "中证A股全收益",
    totalReturn: true,
  },
  {
    id: "h00922-h00985",
    title: "红利 vs 中证全指",
    a: "H00922",
    b: "H00985",
    aName: "中证红利全收益",
    bName: "中证全指全收益",
    totalReturn: true,
  },
  {
    id: "000922-930903",
    title: "红利 vs 中证A股",
    a: "000922",
    b: "930903",
    aName: "中证红利",
    bName: "中证A股",
    totalReturn: false,
  },
  {
    id: "000922-000985",
    title: "红利 vs 中证全指",
    a: "000922",
    b: "000985",
    aName: "中证红利",
    bName: "中证全指",
    totalReturn: false,
  },
];

export type ResolvedRotationPair = {
  id: string;
  title: string;
  a: string;
  b: string;
  aName: string;
  bName: string;
  totalReturn: boolean;
};

export function resolveRotationPair(pair: ResolvedRotationPair): ResolvedRotationPair {
  return pair;
}

export function findRotationPair(id: string): ResolvedRotationPair | undefined {
  return ROTATION_PAIRS.find((pair) => pair.id === id);
}

export function findInstrument(symbol: string): InstrumentInfo | undefined {
  return SEEDED_INSTRUMENTS.find((item) => item.symbol === symbol);
}

/** Daily (or weekly) session. Null OHLC means the source published close only. */
export type DailyBar = {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  amount: number | null;
};

export type Candle = {
  time: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

export type MaPoint = {
  time: string;
  value: number;
};

export type TierRow = {
  tier: TierLevel;
  label: string;
  /** 偏低 / 偏热 / 过热 / 顶部区域 are derived names, not the owner's rule. */
  derived: boolean;
  level: number;
  /** (level - lastClose) / lastClose * 100. Positive means the tier is above the close. */
  distancePct: number;
  /** Share of weekly close/MA55 readings strictly below this tier ratio, 0–100. */
  ratioPercentile: number;
  /** Consecutive weeks on the active side of the tier count as one episode. */
  episodeCount: number;
  /** Weeks inside those episodes. */
  episodeWeeks: number;
  /** Week-ending date of the latest episode, if any. */
  latestEpisode: string | null;
};

export type LowTag = "史诗底" | "重要底" | "其他";

export type LowRow = {
  weekEnd: string;
  weekLow: number;
  ma55: number;
  ratioPct: number;
  confirmed: boolean;
  /** Latest week has not reached its Friday session yet. */
  possiblyOpen: boolean;
  tag: LowTag;
};

export type SignificantLowMarker = {
  time: string;
  price: number;
  ratio: number;
  confirmed: boolean;
  possiblyOpen: boolean;
  label: string;
};

export type Overview = {
  instrument: InstrumentInfo;
  /** ISO datetime, market close in Asia/Shanghai. */
  asOf: string;
  weekPossiblyOpen: boolean;
  lastClose: number;
  previousClose: number | null;
  changePct: number | null;
  ma55: number;
  /** lastClose / ma55 * 100 */
  ratioPct: number;
  /**
   * 0–100. Current weekly close/MA55 is higher than this percentage of
   * weekly ratios from the first MA55 week through the latest week.
   */
  percentile: number;
  percentileSample: number;
  tiers: TierRow[];
  lows: LowRow[];
  daily: Candle[];
  weekly: Candle[];
  ma55Weekly: MaPoint[];
  /**
   * Compact dividend-temperature reading for this symbol, when it is a
   * temperature leg and a series has been stored. High means expensive.
   * Omitted by `buildOverview`; the site route fills it.
   */
  temperature?: OverviewTemperature | null;
};

export type PositionZone = "史诗底" | "重要底" | "偏低" | "中性" | "偏高";

/** Narrative bands for the 1–100 temperature. Display copy is provisional. */
export type TemperatureBand = "extreme_cold" | "cold" | "neutral" | "hot" | "extreme_hot";

export type TemperatureMethod = "quantile_blend" | "zscore_logistic" | "rule_tree";

export type TemperatureFamilyId = "dividend" | "lowvol";

export type OverviewTemperature = {
  value: number;
  tradeDate: string;
  asOf: string;
  method: TemperatureMethod;
  version: number;
  pa: number;
  pb: number;
  spread40: number;
  band: TemperatureBand;
};

export { DIVIDEND_DISCLAIMER, YIELD_NOTE } from "./dividends.js";
export type {
  AshareBoard,
  AshareMarket,
  DividendEventDto,
  DividendEventKind,
  DividendYears,
  PortfolioWeight,
  StockDetailResponse,
  StockListItem,
  StockListQuery,
  StockListResponse,
  StockMarketFilter,
  StockSort,
} from "./dividends.js";

export type TemperatureHistoryPoint = {
  date: string;
  temperature: number;
  pa: number;
  pb: number;
  spread40: number;
};

export type TemperatureResponse = {
  asOf: string;
  tradeDate: string;
  temperature: number;
  band: TemperatureBand;
  /** Provisional Chinese band name. The scale wording is not final. */
  label: string;
  extreme: "cold" | "hot" | null;
  semantics: "high_means_expensive";
  method: TemperatureMethod;
  version: number;
  pa: number;
  pb: number;
  spread40: number;
  ratio: number;
  weightOwn: number;
  coldMax: number;
  hotMin: number;
  dividend: { symbol: string; name: string; priceSymbol: string; priceName: string };
  broad: { symbol: string; name: string };
  history: TemperatureHistoryPoint[];
};
