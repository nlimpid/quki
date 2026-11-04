import type { Candle, DailyBar, InstrumentInfo, MaPoint, Overview } from "@quki/types";

import { computeWeekMetrics, findSignificantLows, tierRows } from "./metrics.js";
import { toWeeklyBars, type WeeklyBar } from "./weekly.js";

function candleFromDaily(bar: DailyBar): Candle {
  return {
    time: bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

function candleFromWeek(week: WeeklyBar): Candle {
  return {
    time: week.date,
    open: week.open,
    high: week.high,
    low: week.low,
    close: week.close,
    volume: week.volume,
  };
}

export function buildOverview(
  daily: readonly DailyBar[],
  instrument: InstrumentInfo,
): Overview | null {
  if (daily.length === 0) return null;
  const ordered = [...daily].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const weeks = toWeeklyBars(ordered);
  const metrics = computeWeekMetrics(weeks);
  const latest = metrics[metrics.length - 1];
  const lastDaily = ordered[ordered.length - 1];
  const prevDaily = ordered[ordered.length - 2];
  if (!latest || !lastDaily) return null;

  const maPoints: MaPoint[] = metrics.map((row) => ({ time: row.date, value: row.ma }));
  const lows = findSignificantLows(metrics).sort((a, b) => (a.weekEnd < b.weekEnd ? 1 : -1));

  return {
    instrument,
    asOf: `${lastDaily.date}T15:00:00+08:00`,
    weekPossiblyOpen: weeks[weeks.length - 1]?.possiblyOpen ?? false,
    lastClose: lastDaily.close,
    previousClose: prevDaily?.close ?? null,
    changePct:
      prevDaily && prevDaily.close !== 0
        ? ((lastDaily.close - prevDaily.close) / prevDaily.close) * 100
        : null,
    ma55: latest.ma,
    ratioPct: (lastDaily.close / latest.ma) * 100,
    percentile: latest.percentile,
    percentileSample: metrics.length,
    tiers: tierRows(metrics, latest.ma, lastDaily.close),
    lows,
    daily: ordered.map(candleFromDaily),
    weekly: weeks.map(candleFromWeek),
    ma55Weekly: maPoints,
  };
}
