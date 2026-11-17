import { isoWeekKey } from "@quki/analytics";
import type { Candle, LowRow, MaPoint, Overview, Period, RangeKey, TierLevel } from "@quki/types";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type MouseEventParams,
  type SeriesMarker,
} from "lightweight-charts";
import { Checkbox, Table } from "@heroui/react";
import { useEffect, useMemo, useRef, useState } from "react";

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
import { ChartAttribution } from "./chartAttribution.js";
import { FilterGroup } from "./FilterGroup.js";
import { lineWithGaps, splitPriceSeries, volumeBars } from "./klineModel.js";
import { nextVisibleWindow, rangeNeedsApply, VisibleRangeControl } from "./VisibleRangeControl.js";

const CHART_TIERS = [85, 95, 105, 115] as const;

const TIER_RATIOS: { tier: TierLevel; ratio: number; name: string }[] = [
  { tier: 85, ratio: 0.85, name: "85% 史诗底" },
  { tier: 90, ratio: 0.9, name: "90% 重要底" },
  { tier: 95, ratio: 0.95, name: "95%" },
  { tier: 100, ratio: 1, name: "MA55" },
  { tier: 105, ratio: 1.05, name: "105%" },
  { tier: 110, ratio: 1.1, name: "110% 过热" },
  { tier: 115, ratio: 1.15, name: "115% 顶部区域" },
];

function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

const RANGES: { id: RangeKey; label: string }[] = [
  { id: "1Y", label: "1年" },
  { id: "3Y", label: "3年" },
  { id: "5Y", label: "5年" },
  { id: "10Y", label: "10年" },
  { id: "MAX", label: "全部" },
];

function markerTime(marker: LowRow, candles: Candle[], period: Period): string | null {
  if (period === "W")
    return candles.some((candle) => candle.time === marker.weekEnd) ? marker.weekEnd : null;
  const exact = candles.find((candle) => candle.time === marker.weekEnd);
  if (exact) return exact.time;
  const sameWeek = candles.find((candle) => isoWeekKey(candle.time) === isoWeekKey(marker.weekEnd));
  return sameWeek?.time ?? null;
}

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
  onPeriod,
  onRange,
}: {
  overview: Overview;
  period: Period;
  range: RangeKey;
  showVolume: boolean;
  onToggleVolume: (value: boolean) => void;
  onPeriod?: (period: Period) => void;
  onRange?: (range: RangeKey) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const { theme } = useTheme();
  const [readout, setReadout] = useState<string>("移动十字线查看开高低收。");
  const [visible, setVisible] = useState<{ from: number; to: number; last: number } | null>(null);
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
  const placed = useMemo(
    () =>
      markers
        .flatMap((marker) => {
          const time = markerTime(marker, candles, period);
          return time ? [{ marker, time }] : [];
        })
        .sort((left, right) => left.time.localeCompare(right.time)),
    [markers, candles, period],
  );
  const percentiles = useMemo(() => percentileByWeek(overview), [overview]);

  useEffect(() => {
    const el = host.current;
    if (!el || candles.length === 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.documentElement.dataset.theme = theme;
    const axisColor = cssVar(el, "--qk-chart-axis");
    const up = cssVar(el, "--qk-candle-up");
    const down = cssVar(el, "--qk-candle-down");
    const cold = cssVar(el, "--qk-val-cold") || cssVar(el, "--qk-tier-85-stroke");
    const hot = cssVar(el, "--qk-val-hot") || cssVar(el, "--qk-tier-105-stroke");
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: axisColor,
        fontFamily: cssVar(el, "--qk-font-tabular"),
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: cssVar(el, "--qk-chart-grid") },
        horzLines: { color: cssVar(el, "--qk-chart-grid") },
      },
      crosshair: {
        vertLine: { color: cssVar(el, "--qk-chart-crosshair") },
        horzLine: { color: cssVar(el, "--qk-chart-crosshair") },
      },
      rightPriceScale: {
        borderColor: cssVar(el, "--qk-chart-grid"),
        scaleMargins: { top: 0.06, bottom: 0.06 },
      },
      timeScale: { borderColor: cssVar(el, "--qk-chart-grid") },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      kineticScroll: { touch: !reduce, mouse: false },
    });
    chartRef.current = chart;
    const price = splitPriceSeries(candles);
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      borderUpColor: cssVar(el, "--qk-candle-border-up"),
      borderDownColor: cssVar(el, "--qk-candle-border-down"),
      wickUpColor: up,
      wickDownColor: down,
    });
    candleSeries.setData(price.candles);
    const closeSeries = chart.addSeries(LineSeries, {
      color: cssVar(el, "--qk-series-close") || cssVar(el, "--qk-text-secondary"),
      lineWidth: 1,
      pointMarkersVisible: true,
    });
    closeSeries.setData(price.closeOnly);
    const maSeries = chart.addSeries(LineSeries, {
      color: cssVar(el, "--qk-ma55"),
      lineWidth: 2,
      pointMarkersVisible: false,
    });
    maSeries.setData(lineWithGaps(candles, maAligned));
    for (const tier of TIER_RATIOS) {
      if (!CHART_TIERS.includes(tier.tier as (typeof CHART_TIERS)[number])) continue;
      const series = chart.addSeries(LineSeries, {
        color: tier.ratio < 1 ? cold : hot,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        pointMarkersVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      series.setData(
        lineWithGaps(
          candles,
          maAligned.map((value) => (value == null ? null : value * tier.ratio)),
        ),
      );
    }
    const candleTimes = new Set(
      candles
        .filter((candle) => candle.open != null && candle.high != null && candle.low != null)
        .map((candle) => candle.time),
    );
    const toMarker = (marker: LowRow, time: string): SeriesMarker<string> => ({
      time,
      position: "belowBar",
      shape: marker.confirmed ? "arrowDown" : "square",
      color: marker.confirmed
        ? cssVar(el, "--qk-marker-confirmed")
        : cssVar(el, "--qk-marker-unconfirmed"),
      size: 2,
    });
    createSeriesMarkers(
      candleSeries,
      placed
        .filter((item) => candleTimes.has(item.time))
        .map((item) => toMarker(item.marker, item.time))
        .sort((left, right) => left.time.localeCompare(right.time)),
    );
    createSeriesMarkers(
      closeSeries,
      placed
        .filter((item) => !candleTimes.has(item.time))
        .map((item) => toMarker(item.marker, item.time))
        .sort((left, right) => left.time.localeCompare(right.time)),
    );
    if (showVolume) {
      const volume = chart.addSeries(
        HistogramSeries,
        {
          priceFormat: {
            type: "custom",
            minMove: 1,
            formatter: (value: number) => formatVolume(value),
          },
          priceLineVisible: false,
          lastValueVisible: false,
        },
        1,
      );
      volume.setData(
        volumeBars(candles, cssVar(el, "--qk-volume-up"), cssVar(el, "--qk-volume-down")),
      );
      const volumeHeight = Number.parseFloat(cssVar(el, "--qk-volume-h"));
      chart.panes()[1]?.setHeight(Number.isFinite(volumeHeight) ? volumeHeight : 42);
    }
    const onMove = (param: MouseEventParams) => {
      const time = typeof param.time === "string" ? param.time : "";
      const candle = candles.find((item) => item.time === time);
      if (!candle) {
        setReadout("移动十字线查看开高低收。");
        return;
      }
      const index = candles.indexOf(candle);
      const ma = maAligned[index];
      const ratio = ma ? (candle.close / ma) * 100 : null;
      const zone = ratio == null ? null : positionZone(ratio);
      const percentile = percentiles.get(isoWeekKey(candle.time));
      const latest = index === candles.length - 1 ? overview.temperature : null;
      const ohlc =
        candle.open == null || candle.high == null || candle.low == null
          ? `收 ${formatLevel(candle.close)}`
          : `开 ${formatLevel(candle.open)} 高 ${formatLevel(candle.high)} 低 ${formatLevel(candle.low)} 收 ${formatLevel(candle.close)}`;
      const volumeText =
        showVolume && candle.volume != null ? ` 量 ${formatVolume(candle.volume)}` : "";
      const mark = placed.find((item) => item.time === candle.time);
      const markText = mark ? (mark.marker.confirmed ? " 已确认" : " 未确认") : "";
      const temp = latest ? ` 温度 ${latest.value} ${temperatureBandLabel(latest.band)}` : "";
      setReadout(
        `${candle.time} · ${period === "W" ? "周线" : "日线"}${temp} 区间 ${ratio == null ? "—" : formatPct(ratio)} 档位 ${zone?.label ?? "—"} 历史分位 ${percentile == null ? "—" : formatPercentile(percentile)}${markText} ${ohlc}${volumeText}`,
      );
    };
    chart.subscribeCrosshairMove(onMove);
    const syncVisible = () => {
      const logical = chart.timeScale().getVisibleLogicalRange();
      if (!logical) return;
      const last = Math.max(0, candles.length - 1);
      setVisible((previous) => nextVisibleWindow(previous, logical, last));
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(syncVisible);
    syncVisible();
    const observer = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth });
    });
    observer.observe(el);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(syncVisible);
      chart.unsubscribeCrosshairMove(onMove);
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, maAligned, placed, percentiles, period, showVolume, theme, overview.temperature]);

  const volumeToggle = (
    <Checkbox className="volume-toggle" isSelected={showVolume} onChange={onToggleVolume}>
      <Checkbox.Control>
        <Checkbox.Indicator />
      </Checkbox.Control>
      <Checkbox.Content>成交量</Checkbox.Content>
    </Checkbox>
  );

  return (
    <section className="chart-panel">
      <div className="chart-tools">
        <div className="chart-tools-main">
          <div className="chart-title">K 线 · MA55 与估值分位</div>
          <div className="legend">
            <span>
              <i className="sw" style={{ background: "var(--qk-candle-up)" }} />涨
            </span>
            <span>
              <i className="sw" style={{ background: "var(--qk-candle-down)" }} />跌
            </span>
            <span>
              <i className="sw-line" />
              MA55
            </span>
            <span>
              <i className="sw-dash" />
              估值线
            </span>
          </div>
        </div>
        {onPeriod && onRange ? (
          <div className="chart-tools-controls">
            <div className="chart-period-row">
              <FilterGroup
                appearance="chip"
                label="周期"
                value={period}
                options={[
                  { id: "D", label: "日" },
                  { id: "W", label: "周" },
                ]}
                onChange={onPeriod}
              />
              {volumeToggle}
            </div>
            <FilterGroup
              appearance="chip"
              label="窗口"
              value={range}
              options={RANGES}
              onChange={onRange}
            />
          </div>
        ) : (
          volumeToggle
        )}
      </div>
      <p className="chart-readout" data-chart-readout="kline">
        {readout}
      </p>
      <div className="chart-body">
        {candles.length === 0 ? (
          <div className="state">暂无数据</div>
        ) : (
          <div
            ref={host}
            className={showVolume ? "chart-box with-volume" : "chart-box"}
            role="img"
            aria-label={`${overview.instrument.shortName} ${period === "W" ? "周线" : "日线"} K 线`}
            aria-describedby="kline-marker-key"
            data-points={candles.length}
            data-markers={placed.length}
            data-volume={candles.filter((candle) => candle.volume != null).length}
            data-volume-missing={candles.filter((candle) => candle.volume == null).length}
            data-ohlc={
              candles.filter(
                (candle) => candle.open != null && candle.high != null && candle.low != null,
              ).length
            }
            data-close-only={
              candles.filter(
                (candle) => candle.open == null || candle.high == null || candle.low == null,
              ).length
            }
          />
        )}
      </div>
      {visible ? (
        <VisibleRangeControl
          from={visible.from}
          to={visible.to}
          last={visible.last}
          onChange={(from, to) => {
            const scale = chartRef.current?.timeScale();
            if (!scale || !rangeNeedsApply(scale.getVisibleLogicalRange(), from, to)) return;
            scale.setVisibleLogicalRange({ from, to });
          }}
          onReset={() => chartRef.current?.timeScale().fitContent()}
        />
      ) : null}
      <ChartAttribution />
      <p className="chart-key" id="kline-marker-key">
        已确认和未确认用不同形状：已确认是向下箭头，未确认是方块。涨为红色，跌为绿色。
      </p>
      <details className="data-fallback">
        <summary>查看数据表</summary>
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="最近十二根K线">
              <Table.Header>
                <Table.Column isRowHeader>日期</Table.Column>
                <Table.Column>开</Table.Column>
                <Table.Column>高</Table.Column>
                <Table.Column>低</Table.Column>
                <Table.Column>收</Table.Column>
                <Table.Column>MA55</Table.Column>
              </Table.Header>
              <Table.Body>
                {candles.slice(-12).map((candle, index) => {
                  const offset = Math.max(0, candles.length - 12) + index;
                  const ma = maAligned[offset];
                  return (
                    <Table.Row key={candle.time} id={candle.time}>
                      <Table.Cell className="num">{candle.time}</Table.Cell>
                      <Table.Cell className="num">
                        {candle.open == null ? "—" : formatLevel(candle.open)}
                      </Table.Cell>
                      <Table.Cell className="num">
                        {candle.high == null ? "—" : formatLevel(candle.high)}
                      </Table.Cell>
                      <Table.Cell className="num">
                        {candle.low == null ? "—" : formatLevel(candle.low)}
                      </Table.Cell>
                      <Table.Cell className="num">{formatLevel(candle.close)}</Table.Cell>
                      <Table.Cell className="num">{ma == null ? "—" : formatLevel(ma)}</Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </details>
    </section>
  );
}
