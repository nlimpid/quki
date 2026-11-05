import { isoWeekKey } from "@quki/analytics";
import type { Candle, LowRow, MaPoint, Overview, Period, RangeKey, TierLevel } from "@quki/types";
import { BarChart, CandlestickChart, LineChart, ScatterChart } from "echarts/charts";
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useMemo, useRef } from "react";

import {
  formatLevel,
  formatPct,
  formatPercentile,
  formatVolume,
  positionZone,
  rangeStart,
  temperatureBandLabel,
} from "../lib/format.js";
import { useTheme } from "../lib/theme.js";

echarts.use([
  CandlestickChart,
  LineChart,
  BarChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

const CHART_TIERS = new Set<TierLevel>([85, 95, 105, 115]);

const TIER_RATIOS: { tier: TierLevel; ratio: number; name: string }[] = [
  { tier: 85, ratio: 0.85, name: "85% 史诗底" },
  { tier: 90, ratio: 0.9, name: "90% 重要底" },
  { tier: 95, ratio: 0.95, name: "95%" },
  { tier: 100, ratio: 1, name: "MA55" },
  { tier: 105, ratio: 1.05, name: "105%" },
  { tier: 110, ratio: 1.1, name: "110% 过热" },
  { tier: 115, ratio: 1.15, name: "115% 顶部区域" },
];

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function markerTime(marker: LowRow, candles: Candle[], period: Period): string | null {
  if (period === "W")
    return candles.some((candle) => candle.time === marker.weekEnd) ? marker.weekEnd : null;
  const exact = candles.find((candle) => candle.time === marker.weekEnd);
  if (exact) return exact.time;
  const sameWeek = candles.find((candle) => isoWeekKey(candle.time) === isoWeekKey(marker.weekEnd));
  return sameWeek?.time ?? null;
}

function priceExtent(candles: Candle[], ma: readonly (number | null)[]): [number, number] {
  const values: number[] = [];
  for (const candle of candles)
    values.push(candle.high ?? candle.close, candle.low ?? candle.close);
  for (const value of ma) {
    if (value != null) values.push(value * 0.85, value * 1.15);
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.06 || 1;
  return [lo - pad, hi + pad];
}

/** Expanding close/MA55 percentile by ISO week, same strictly-below rule as the study. */
function percentileByWeek(overview: Overview): Map<string, number> {
  const ma = new Map(overview.ma55Weekly.map((point) => [point.time, point.value]));
  const ratios: { week: string; ratio: number }[] = [];
  for (const week of overview.weekly) {
    const average = ma.get(week.time);
    if (average == null || average === 0) continue;
    ratios.push({ week: isoWeekKey(week.time), ratio: week.close / average });
  }
  const byWeek = new Map<string, number>();
  for (let i = 0; i < ratios.length; i += 1) {
    const current = ratios[i];
    if (!current) continue;
    let below = 0;
    for (let j = 0; j <= i; j += 1) {
      const earlier = ratios[j];
      if (earlier && earlier.ratio < current.ratio) below += 1;
    }
    byWeek.set(current.week, (below / (i + 1)) * 100);
  }
  return byWeek;
}

function alignMa(candles: Candle[], ma: MaPoint[], period: Period): (number | null)[] {
  if (period === "W") {
    const map = new Map(ma.map((point) => [point.time, point.value]));
    return candles.map((candle) => map.get(candle.time) ?? null);
  }
  const byWeek = new Map<string, number>();
  for (const point of ma) byWeek.set(isoWeekKey(point.time), point.value);
  return candles.map((candle) => byWeek.get(isoWeekKey(candle.time)) ?? null);
}

export function KlineChart({
  overview,
  period,
  range,
  showVolume,
  onToggleVolume,
}: {
  overview: Overview;
  period: Period;
  range: RangeKey;
  showVolume: boolean;
  onToggleVolume: (value: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const asOfDate = overview.asOf.slice(0, 10);
  const start = rangeStart(asOfDate, range);
  const source = period === "W" ? overview.weekly : overview.daily;
  const candles = useMemo(
    () => source.filter((candle) => (start ? candle.time >= start : true)),
    [source, start],
  );
  const maAligned = useMemo(
    () => alignMa(candles, overview.ma55Weekly, period),
    [candles, overview.ma55Weekly, period],
  );
  const markers = useMemo(
    () => overview.lows.filter((low) => !start || low.weekEnd >= start),
    [overview.lows, start],
  );
  const percentiles = useMemo(() => percentileByWeek(overview), [overview]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    void theme;
    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    const up = cssVar("--qk-candle-up");
    const down = cssVar("--qk-candle-down");
    const upBorder = cssVar("--qk-candle-border-up");
    const downBorder = cssVar("--qk-candle-border-down");
    const maColor = cssVar("--qk-ma55");
    const grid = cssVar("--qk-chart-grid");
    const axis = cssVar("--qk-chart-axis");
    const text = cssVar("--qk-text-primary");
    const secondary = cssVar("--qk-text-secondary");
    const cross = cssVar("--qk-chart-crosshair");
    const tipBg = cssVar("--qk-chart-tooltip-bg");
    const tipBorder = cssVar("--qk-chart-tooltip-border");
    const confirmed = cssVar("--qk-marker-confirmed");
    const unconfirmed = cssVar("--qk-marker-unconfirmed");
    const stroke = cssVar("--qk-marker-stroke");
    const font = cssVar("--qk-font-sans");
    const mono = cssVar("--qk-font-tabular");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const categories = candles.map((candle) => candle.time);
    const candleData = candles.map((candle) =>
      candle.open == null || candle.high == null || candle.low == null
        ? "-"
        : [candle.open, candle.close, candle.low, candle.high],
    );
    const closeOnly = candles.map((candle) =>
      candle.open == null || candle.high == null || candle.low == null ? candle.close : null,
    );
    const levels = TIER_RATIOS.map((tier) =>
      maAligned.map((value) => (value == null ? null : value * tier.ratio)),
    );
    const bandSeries = TIER_RATIOS.flatMap((tier, index) => {
      if (!CHART_TIERS.has(tier.tier)) return [];
      const color = cssVar(`--qk-tier-${tier.tier}-stroke`);
      return [
        {
          name: tier.name,
          type: "line" as const,
          data: levels[index] ?? [],
          symbol: "none",
          connectNulls: false,
          silent: true,
          z: 1,
          lineStyle: { width: 1, type: [3, 4] as const, color },
          tooltip: { show: false },
        },
      ];
    });

    const [yMin, yMax] = priceExtent(candles, maAligned);
    const lowsInView = markers.flatMap((marker) => {
      const placed = markerTime(marker, candles, period);
      return placed ? [{ marker, time: placed }] : [];
    });

    const volume = showVolume
      ? {
          grid: [
            { left: 16, right: 118, top: 16, bottom: 92 },
            { left: 16, right: 118, height: 48, bottom: 36 },
          ],
          xAxis: [
            {
              type: "category",
              data: categories,
              gridIndex: 0,
              axisLabel: { show: false },
              axisLine: { lineStyle: { color: grid } },
            },
            {
              type: "category",
              data: categories,
              gridIndex: 1,
              axisLabel: { color: axis, fontSize: 11, fontFamily: mono, hideOverlap: true },
              axisLine: { lineStyle: { color: grid } },
            },
          ],
          yAxis: [
            {
              min: yMin,
              max: yMax,
              scale: true,
              gridIndex: 0,
              axisLabel: { color: axis, fontSize: 11, fontFamily: mono },
              splitLine: { lineStyle: { color: grid } },
            },
            { scale: true, gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false } },
          ],
        }
      : {
          grid: { left: 16, right: 118, top: 16, bottom: 32 },
          xAxis: {
            type: "category",
            data: categories,
            axisLabel: { color: axis, fontSize: 11, fontFamily: mono, hideOverlap: true },
            axisLine: { lineStyle: { color: grid } },
          },
          yAxis: {
            min: yMin,
            max: yMax,
            scale: true,
            axisLabel: { color: axis, fontSize: 11, fontFamily: mono },
            splitLine: { lineStyle: { color: grid } },
          },
        };

    chart.setOption({
      animation: !reduce,
      animationDuration: reduce ? 0 : 200,
      textStyle: { fontFamily: font },
      axisPointer: { link: [{ xAxisIndex: "all" }], lineStyle: { color: cross, type: "dashed" } },
      tooltip: {
        trigger: "axis",
        backgroundColor: tipBg,
        borderColor: tipBorder,
        textStyle: { color: text, fontSize: 12, fontFamily: font },
        extraCssText:
          "border-radius:12px;box-shadow:0 8px 24px rgba(24,24,27,0.08),0 2px 6px rgba(24,24,27,0.04);padding:14px 16px;",
        formatter: (raw: unknown) => {
          const items = Array.isArray(raw) ? raw : [raw];
          const first = items[0] as { dataIndex?: number } | undefined;
          const index = first?.dataIndex ?? 0;
          const candle = candles[index];
          if (!candle) return "";
          const ma = maAligned[index];
          const ratioValue = ma ? (candle.close / ma) * 100 : null;
          const zone = ratioValue == null ? null : positionZone(ratioValue);
          const percentile = percentiles.get(isoWeekKey(candle.time));
          const latest = index === candles.length - 1;
          const temperature = latest ? overview.temperature : null;
          const tempRow = temperature
            ? `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:10px"><span style="color:${secondary}">温度</span><b style="font-family:${mono};font-weight:600">${temperature.value} ${temperatureBandLabel(temperature.band)}</b></div>`
            : "";
          const ohlc =
            candle.open == null
              ? `收 ${formatLevel(candle.close)}`
              : `开 ${formatLevel(candle.open)}　高 ${formatLevel(candle.high ?? candle.close)}<br/>低 ${formatLevel(candle.low ?? candle.close)}　收 ${formatLevel(candle.close)}`;
          const vol =
            showVolume && candle.volume != null ? `<br/>成交量 ${formatVolume(candle.volume)}` : "";
          const row = (label: string, value: string) =>
            `<div style="display:flex;justify-content:space-between;gap:16px;margin-top:8px"><span style="color:${secondary}">${label}</span><b style="font-family:${mono};font-weight:500;color:${text}">${value}</b></div>`;
          return `<div style="min-width:180px;font-family:${font};color:${text}">
            <div style="color:${secondary};font-size:12px">${candle.time} · ${period === "W" ? "周线" : "日线"}</div>
            ${tempRow}
            ${row("区间", ratioValue == null ? "—" : formatPct(ratioValue))}
            ${row("档位", zone?.label ?? "—")}
            ${row("历史分位", percentile == null ? "—" : formatPercentile(percentile))}
            <details style="margin-top:10px;color:${secondary};font-size:12px">
              <summary style="cursor:pointer">开高低收</summary>
              <div style="margin-top:6px;font-family:${mono};color:${text}">${ohlc}${vol}</div>
            </details>
          </div>`;
        },
      },
      dataZoom: [{ type: "inside", xAxisIndex: showVolume ? [0, 1] : 0 }],
      ...volume,
      series: [
        ...bandSeries,
        {
          name: "MA55",
          type: "line",
          data: maAligned,
          symbol: "none",
          connectNulls: false,
          z: 5,
          lineStyle: { width: 1.75, color: maColor },
          itemStyle: { color: maColor },
        },
        {
          name: "行情",
          type: "candlestick",
          data: candleData,
          z: 4,
          itemStyle: {
            color: up,
            color0: down,
            borderColor: upBorder,
            borderColor0: downBorder,
          },
        },
        {
          name: "收盘",
          type: "line",
          data: closeOnly,
          connectNulls: false,
          showSymbol: true,
          symbol: "circle",
          symbolSize: 4,
          z: 4,
          lineStyle: { width: 1.25, color: secondary },
          itemStyle: { color: secondary },
        },
        {
          name: "显著低点",
          type: "scatter",
          data: lowsInView.map(({ marker, time }) => ({
            value: [time, marker.weekLow],
            symbol: marker.confirmed ? "triangle" : "diamond",
            symbolRotate: marker.confirmed ? 180 : 0,
            symbolSize: 10,
            symbolOffset: [0, 8],
            itemStyle: {
              color: marker.confirmed ? confirmed : unconfirmed,
              borderColor: stroke,
              borderWidth: 1.5,
            },
          })),
          z: 6,
          tooltip: { show: false },
        },
        ...(showVolume
          ? [
              {
                name: "成交量",
                type: "bar" as const,
                xAxisIndex: 1,
                yAxisIndex: 1,
                data: candles.map((candle, index) => {
                  const prev = candles[index - 1]?.close ?? candle.open ?? candle.close;
                  const rising = candle.close >= prev;
                  return {
                    value: candle.volume,
                    itemStyle: {
                      color: rising ? cssVar("--qk-volume-up") : cssVar("--qk-volume-down"),
                    },
                  };
                }),
                tooltip: { show: false },
              },
            ]
          : []),
      ],
    });

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [candles, maAligned, markers, percentiles, period, showVolume, theme, overview.temperature]);

  return (
    <section className="card chart-card">
      <div className="card-hd">
        <div>
          <div className="card-title">K 线 · MA55 与估值分位</div>
          <div className="legend">
            <span>
              <i className="sw" style={{ background: "var(--qk-candle-up)" }} />涨
            </span>
            <span>
              <i className="sw" style={{ background: "var(--qk-candle-down)" }} />跌
            </span>
            <span>
              <i className="sw-line" />
              MA55（周）
            </span>
            <span>
              <i className="sw-dash" />
              估值线 · 冷→热
            </span>
            <span>▼ 已确认</span>
            <span>◇ 未确认</span>
          </div>
        </div>
        <label className="chk">
          <input
            type="checkbox"
            checked={showVolume}
            onChange={(event) => onToggleVolume(event.target.checked)}
          />
          成交量
        </label>
      </div>
      <div className="chart-body">
        {candles.length === 0 ? (
          <div className="state">暂无行情数据</div>
        ) : (
          <div
            ref={host}
            className={showVolume ? "chart-box with-volume" : "chart-box"}
            role="img"
            aria-label={`${overview.instrument.shortName} ${period === "W" ? "周线" : "日线"} K 线`}
          />
        )}
      </div>
      <details className="data-fallback">
        <summary>查看数据表</summary>
        <div className="table-scroll">
          <table className="qk">
            <thead>
              <tr>
                <th>日期</th>
                <th>开</th>
                <th>高</th>
                <th>低</th>
                <th>收</th>
                <th>MA55</th>
              </tr>
            </thead>
            <tbody>
              {candles.slice(-12).map((candle, index) => {
                const offset = Math.max(0, candles.length - 12) + index;
                const ma = maAligned[offset];
                return (
                  <tr key={candle.time}>
                    <td className="num">{candle.time}</td>
                    <td className="num">{candle.open == null ? "—" : formatLevel(candle.open)}</td>
                    <td className="num">{candle.high == null ? "—" : formatLevel(candle.high)}</td>
                    <td className="num">{candle.low == null ? "—" : formatLevel(candle.low)}</td>
                    <td className="num">{formatLevel(candle.close)}</td>
                    <td className="num">{ma == null ? "—" : formatLevel(ma)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
