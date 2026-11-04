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

import { formatLevel, formatPct, formatVolume, rangeStart } from "../lib/format.js";
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
    const latestLevels = levels.map((series) => {
      for (let i = series.length - 1; i >= 0; i -= 1) {
        const value = series[i];
        if (value != null) return value;
      }
      return null;
    });

    const bandSeries = TIER_RATIOS.map((tier, index) => {
      const level = levels[index] ?? [];
      const prev = index === 0 ? null : levels[index - 1];
      const data =
        index === 0
          ? level
          : level.map((value, i) => {
              const lower = prev?.[i];
              if (value == null || lower == null) return null;
              return value - lower;
            });
      const color = cssVar(`--qk-tier-${tier.tier}-stroke`);
      const fill = cssVar(`--qk-tier-${index === 0 ? 85 : TIER_RATIOS[index - 1]?.tier}-fill`);
      const latest = latestLevels[index];
      return {
        name: tier.name,
        type: "line" as const,
        stack: "bands",
        data,
        symbol: "none",
        connectNulls: false,
        silent: true,
        z: 1,
        lineStyle: { width: 1, type: "dashed" as const, color },
        ...(index === 0 ? {} : { areaStyle: { color: fill, opacity: 1 } }),
        endLabel: {
          show: latest != null,
          formatter: latest == null ? "" : `${tier.tier}% ${formatLevel(latest)}`,
          color: cssVar(`--qk-tier-${tier.tier}-label`),
          fontSize: 10,
          fontFamily: mono,
        },
        tooltip: { show: false },
      };
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
        textStyle: { color: text, fontSize: 12, fontFamily: mono },
        extraCssText: "border-radius:8px;box-shadow:var(--qk-shadow-md)",
        formatter: (raw: unknown) => {
          const items = Array.isArray(raw) ? raw : [raw];
          const first = items[0] as { dataIndex?: number } | undefined;
          const index = first?.dataIndex ?? 0;
          const candle = candles[index];
          if (!candle) return "";
          const ma = maAligned[index];
          const prev = candles[index - 1]?.close;
          const upClose = prev != null && candle.close >= prev;
          const closeColor = upClose ? up : down;
          const ratio = ma ? formatPct((candle.close / ma) * 100) : "—";
          const ohlc =
            candle.open == null
              ? `收 <span style="color:${closeColor}">${formatLevel(candle.close)}</span>`
              : `开 ${formatLevel(candle.open ?? candle.close)}  收 <span style="color:${closeColor}">${formatLevel(candle.close)}</span><br/>高 ${formatLevel(candle.high ?? candle.close)}  低 ${formatLevel(candle.low ?? candle.close)}`;
          const vol =
            showVolume && candle.volume != null ? `<br/>成交量 ${formatVolume(candle.volume)}` : "";
          return `<div style="font-family:${font};color:${secondary}">${candle.time} · ${period === "W" ? "周线" : "日线"}</div>
            <div style="margin-top:4px;color:${text}">${ohlc}</div>
            <div style="color:${maColor}">MA55 ${ma == null ? "—" : formatLevel(ma)} (${ratio})</div>${vol}`;
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
          z: 3,
          lineStyle: { width: 1.5, color: maColor },
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
  }, [candles, maAligned, markers, period, showVolume, theme]);

  return (
    <section className="card chart-card">
      <div className="card-hd">
        <div>
          <div className="card-title">K 线 · MA55 与估值分档</div>
          <div className="legend">
            <span>
              <i className="sw" style={{ background: "var(--qk-candle-up)" }} />
              上涨
            </span>
            <span>
              <i className="sw" style={{ background: "var(--qk-candle-down)" }} />
              下跌
            </span>
            <span>
              <i className="sw-line" />
              MA55（周）
            </span>
            <span>
              <i className="sw" style={{ background: "var(--qk-tier-85-fill)" }} />
              85% 史诗底
            </span>
            <span>
              <i className="sw" style={{ background: "var(--qk-tier-90-fill)" }} />
              90% 重要底
            </span>
            <span>
              <i className="sw" style={{ background: "var(--qk-tier-95-fill)" }} />
              95%
            </span>
            <span>
              <i className="sw" style={{ background: "var(--qk-tier-100-fill)" }} />
              100%
            </span>
            <span>
              <i className="sw" style={{ background: "var(--qk-tier-105-fill)" }} />
              105%
            </span>
            <span>
              <i className="sw" style={{ background: "var(--qk-tier-110-fill)" }} />
              110%
            </span>
            <span>
              <i className="sw" style={{ background: "var(--qk-tier-115-fill)" }} />
              115%
            </span>
            <span>▼ 已确认低点</span>
            <span>◆ 未确认低点</span>
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
