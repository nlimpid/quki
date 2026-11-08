export { ma55BandStrategy, roundTrips, strategies, winRate } from "./backtest.js";
export type { RoundTrip, Strategy, StrategyBar, StrategyTrade } from "./backtest.js";
export {
  computeWeekMetrics,
  findSignificantLows,
  highlightTier,
  percentRankInc,
  percentileStrictlyBelow,
  simpleMovingAverage,
  tierRows,
} from "./metrics.js";
export type { WeekMetric } from "./metrics.js";
export { buildOverview } from "./overview.js";
export {
  alignCloses,
  buildRotationView,
  computeRotation,
  latestSpreadCross,
  ROTATION_DEFAULTS,
} from "./rotation.js";
export type {
  AlignedClose,
  BandCross,
  RotationMarker,
  RotationOptions,
  RotationPoint,
  RotationView,
  ZeroCross,
} from "./rotation.js";
export { MA55_PARAMS, canonicalParams, paramsHash } from "./params.js";
export {
  TEMPERATURE_BROADS,
  TEMPERATURE_FAMILIES,
  MAPPING_SCORE_EPSILON,
  TEMPERATURE_MIN_SPREADS,
  TEMPERATURE_MIN_WEEKS,
  TEMPERATURE_PRICE_STALE_DAYS,
  TEMPERATURE_V1,
  TEMPERATURE_Z_MIN_SPREADS,
  buildSignalRows,
  buildTemperatureReading,
  calendarDaysBetween,
  clampTemperature,
  compactTemperature,
  decideTemperatureWrite,
  isComparable,
  lastBarDate,
  latestAlignedSession,
  methodOf,
  parseTemperatureQuery,
  productionCandidate,
  productionStudyParams,
  quantileTemperature,
  ruleTemperature,
  selectNewTemperatureRows,
  temperatureAt,
  temperatureBand,
  temperatureCandidates,
  temperatureExtreme,
  temperatureFamilyForSymbol,
  temperatureLegs,
  temperaturePoints,
  zTemperature,
} from "./temperature.js";
export type {
  SignalRow,
  TemperatureCandidate,
  TemperatureMapping,
  TemperaturePoint,
  TemperatureStudyLegs,
  TemperatureWriteDecision,
} from "./temperature.js";
export {
  HORIZONS,
  HOLDOUT_CUT,
  bestCandidateId,
  chooseMapping,
  evaluateFrozen,
  modalId,
  prepareSignals,
  runTemperatureStudy,
  selectExtremeThresholds,
  spearman,
  summarizeDist,
  walkForwardMasks,
} from "./temperatureBacktest.js";
export type {
  HorizonKey,
  PreparedRow,
  UniverseStudy,
  WindowReport,
} from "./temperatureBacktest.js";
export {
  addCalendarDays,
  addCalendarMonths,
  adjustedCashPerShare,
  dividendEventKind,
  exDateInYears,
  latestCashDividend,
  portfolioDividendSummary,
  shanghaiDate,
  trailingCashYield,
  trailingWindowStart,
  yearsStart,
} from "./dividendYield.js";
export type {
  HoldingYieldInput,
  PortfolioDividendSummary,
  TrailingCashYield,
  YieldEvent,
} from "./dividendYield.js";
export {
  HOLDINGS_MAX_SHARES,
  HOLDINGS_STORAGE_KEY,
  emptyHoldings,
  removeHolding,
  sanitizeHoldings,
  upsertHolding,
  validShareCount,
} from "./holdings.js";
export type { HoldingRecord, HoldingsState } from "./holdings.js";
export { isoWeekKey, toWeeklyBars, weekFriday } from "./weekly.js";
export type { WeeklyBar } from "./weekly.js";
