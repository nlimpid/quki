import type { RotationView } from "@quki/analytics";
import type { RangeKey } from "@quki/types";
import {
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type LineData,
  type MouseEventParams,
  type SeriesMarker,
  type WhitespaceData,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";

import { rangeStart } from "../lib/format.js";
import { useTheme } from "../lib/theme.js";
import { BandFillPrimitive } from "./bandFill.js";
import { ChartAttribution } from "./chartAttribution.js";
import { VisibleRangeControl } from "./VisibleRangeControl.js";

type Point = RotationView["points"][number];

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function lineData(
  points: readonly Point[],
  pick: (point: Point) => number | null,
): (LineData | WhitespaceData)[] {
  return points.map((point) => {
    const value = pick(point);
    return value == null ? { time: point.date } : { time: point.date, value };
  });
}

function formatNum(value: number | null, digits: number): string {
  return value == null ? "—" : value.toFixed(digits);
}

export function RotationChart({ view, range }: { view: RotationView; range: RangeKey }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const { theme } = useTheme();
  const [readout, setReadout] = useState("移动十字线同时查看四个窗格。");
  const [paneHeights, setPaneHeights] = useState<number[]>([]);
  const [visible, setVisible] = useState<{ from: number; to: number; last: number } | null>(null);
  const start = rangeStart(view.asOf.slice(0, 10), range);
  const points = useMemo(
    () => view.points.filter((point) => (start ? point.date >= start : true)),
    [view.points, start],
  );
  const markers = useMemo(
    () => view.markers.filter((marker) => (start ? marker.date >= start : true)),
    [view.markers, start],
  );

  useEffect(() => {
    const el = host.current;
    if (!el || points.length === 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.documentElement.dataset.theme = theme;
    const axis = cssVar("--qk-chart-axis");
    const text = cssVar("--qk-text-primary");
    const secondary = cssVar("--qk-text-secondary");
    const blue = cssVar("--qk-brand-accent");
    const red = cssVar("--qk-market-up");
    const ma = cssVar("--qk-brand-primary");
    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      autoSize: false,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: axis,
        fontFamily: cssVar("--qk-font-tabular"),
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: cssVar("--qk-chart-grid") },
        horzLines: { color: cssVar("--qk-chart-grid") },
      },
      crosshair: {
        vertLine: { color: cssVar("--qk-chart-crosshair"), style: LineStyle.Dashed },
        horzLine: { color: cssVar("--qk-chart-crosshair"), style: LineStyle.Dashed },
      },
      rightPriceScale: { borderColor: cssVar("--qk-chart-grid") },
      timeScale: { borderColor: cssVar("--qk-chart-grid") },
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
    const shared = { priceLineVisible: false, lastValueVisible: false, pointMarkersVisible: false };
    chart
      .addSeries(LineSeries, { ...shared, color: blue, lineWidth: 2 }, 0)
      .setData(lineData(points, (point) => point.a));
    chart
      .addSeries(
        LineSeries,
        { ...shared, color: secondary, lineWidth: 1, lineStyle: LineStyle.Dashed },
        0,
      )
      .setData(lineData(points, (point) => point.b));
    chart
      .addSeries(
        LineSeries,
        { ...shared, color: axis, lineWidth: 1, lineStyle: LineStyle.Dashed },
        1,
      )
      .setData(lineData(points, (point) => point.lower));
    chart
      .addSeries(
        LineSeries,
        { ...shared, color: axis, lineWidth: 1, lineStyle: LineStyle.Dashed },
        1,
      )
      .setData(lineData(points, (point) => point.upper));
    const relative = chart.addSeries(LineSeries, { ...shared, color: blue, lineWidth: 2 }, 1);
    relative.setData(lineData(points, (point) => point.r));
    const fill = cssVar("--qk-brand-accent-muted");
    relative.attachPrimitive(
      new BandFillPrimitive(
        points.map((point) => ({ time: point.date, upper: point.upper, lower: point.lower })),
        fill.startsWith("#") && fill.length === 7 ? `${fill}8c` : fill,
      ),
    );
    chart
      .addSeries(LineSeries, { ...shared, color: ma, lineWidth: 1 }, 1)
      .setData(lineData(points, (point) => point.ma));
    const spread = chart.addSeries(
      LineSeries,
      {
        ...shared,
        color: text,
        lineWidth: 1,
        priceFormat: {
          type: "custom",
          minMove: 0.0001,
          formatter: (price: number) => `${(price * 100).toFixed(0)}%`,
        },
      },
      2,
    );
    spread.setData(lineData(points, (point) => point.s));
    spread.createPriceLine({
      price: 0,
      color: axis,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: false,
      title: "",
    });
    chart
      .addSeries(
        LineSeries,
        { ...shared, color: ma, lineWidth: 1, lineStyle: LineStyle.Dashed },
        2,
      )
      .setData(lineData(points, (point) => point.sMa));
    const rsi = chart.addSeries(
      LineSeries,
      {
        ...shared,
        color: cssVar("--qk-brand-primary"),
        lineWidth: 2,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      },
      3,
    );
    rsi.setData(lineData(points, (point) => point.rsi));
    chart
      .addSeries(
        LineSeries,
        { ...shared, color: ma, lineWidth: 1, lineStyle: LineStyle.Dashed },
        3,
      )
      .setData(lineData(points, (point) => point.rsiMa));
    const bandMarkers: SeriesMarker<string>[] = markers
      .filter((marker) => marker.kind === "band-above" || marker.kind === "band-below")
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((marker) => ({
        time: marker.date,
        position: marker.kind === "band-above" ? "aboveBar" : "belowBar",
        shape: marker.kind === "band-above" ? "arrowUp" : "arrowDown",
        color: marker.kind === "band-above" ? red : cssVar("--qk-market-down"),
        text: marker.label,
      }));
    createSeriesMarkers(relative, bandMarkers);
    const extremes = markers.filter((marker) => marker.kind === "spread-extreme");
    const spreadMarkers: SeriesMarker<string>[] = markers
      .filter(
        (marker) =>
          marker.kind === "spread-up" ||
          marker.kind === "spread-down" ||
          marker.kind === "spread-extreme",
      )
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((marker) => {
        const extremeIndex = extremes.findIndex(
          (item) => item.date === marker.date && item.label === marker.label,
        );
        const showLabel = marker.kind === "spread-extreme" && extremeIndex >= extremes.length - 3;
        return {
          time: marker.date,
          position: "aboveBar" as const,
          shape: marker.kind === "spread-extreme" ? "square" : "circle",
          color: marker.kind === "spread-extreme" ? cssVar("--qk-warning") : red,
          text: showLabel ? marker.label : undefined,
          price: marker.value,
        };
      });
    createSeriesMarkers(spread, spreadMarkers);
    for (const pane of chart.panes()) pane.setStretchFactor(1);
    requestAnimationFrame(() => {
      if (!el.isConnected) return;
      const heights = chart
        .panes()
        .map((pane) => pane.getHTMLElement()?.clientHeight || pane.getHeight());
      setPaneHeights(heights);
      el.dataset.paneHeights = heights.join(",");
      el.dataset.band = points.some((point) => point.upper != null && point.lower != null)
        ? "filled"
        : "none";
    });
    const onMove = (param: MouseEventParams) => {
      const time = typeof param.time === "string" ? param.time : "";
      const point = points.find((item) => item.date === time);
      if (!point) {
        setReadout("移动十字线同时查看四个窗格。");
        return;
      }
      setReadout(
        `${point.date} · 累计 ${view.pair.aName} ${formatNum(point.a, 3)} / ${view.pair.bName} ${formatNum(point.b, 3)} · R ${formatNum(point.r, 3)} 上轨 ${formatNum(point.upper, 3)} 下轨 ${formatNum(point.lower, 3)} · 收益差 ${point.s == null ? "—" : `${(point.s * 100).toFixed(2)}%`} · RSI ${formatNum(point.rsi, 1)}`,
      );
    };
    chart.subscribeCrosshairMove(onMove);
    const onRange = () => {
      const logical = chart.timeScale().getVisibleLogicalRange();
      if (!logical) return;
      setVisible({ from: logical.from, to: logical.to, last: Math.max(0, points.length - 1) });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    onRange();
    const observer = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    observer.observe(el);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.unsubscribeCrosshairMove(onMove);
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [points, markers, theme, view.pair.aName, view.pair.bName]);

  return (
    <div>
      <div className="legend">
        <span>1 累计收益</span>
        <span>2 相对强弱 R</span>
        <span>3 40日收益差</span>
        <span>4 RSI14</span>
        <span>
          <i className="sw" style={{ background: "var(--qk-brand-accent)" }} />
          {view.pair.aName} / R
        </span>
        <span>
          <i className="sw-dash" />
          {view.pair.bName}
        </span>
        <span>▲▼ 轨道穿越（箭头）</span>
        <span>● 均线穿零（圆点）</span>
        <span>■ 收益差极值（方块）</span>
        <span>
          <i className="sw" style={{ background: "var(--qk-brand-accent-muted)" }} />
          轨道填充
        </span>
      </div>
      <p className="chart-key" id="rotation-marker-key">
        轨道穿越是箭头，均线穿零是圆点，收益差极值是方块。上轨和下轨之间是半透明填充。
      </p>
      <p className="chart-readout" data-chart-readout="rotation">
        {readout}
      </p>
      {visible ? (
        <VisibleRangeControl
          from={visible.from}
          to={visible.to}
          last={visible.last}
          onChange={(from, to) =>
            chartRef.current?.timeScale().setVisibleLogicalRange({ from, to })
          }
          onReset={() => chartRef.current?.timeScale().fitContent()}
        />
      ) : null}
      {points.length === 0 ? (
        <div className="state">暂无轮动数据</div>
      ) : (
        <div className="pane-frame">
          <div className="pane-labels">
            {["累计收益", "相对强弱 R", "40日收益差", "RSI14"].map((label, index) => (
              <div
                key={label}
                className="pane-label"
                style={paneHeights[index] ? { height: paneHeights[index] } : undefined}
              >
                {label}
              </div>
            ))}
          </div>
          <div
            ref={host}
            className="rot-chart"
            role="img"
            aria-label="轮动三棱镜四图"
            aria-describedby="rotation-marker-key"
            data-points={points.length}
            data-panes="4"
          />
        </div>
      )}
      <ChartAttribution />
      <details className="data-fallback">
        <summary>查看数据表</summary>
        <div className="table-scroll">
          <table className="qk">
            <thead>
              <tr>
                <th>日期</th>
                <th>A</th>
                <th>B</th>
                <th>R</th>
                <th>收益差</th>
                <th>RSI14</th>
              </tr>
            </thead>
            <tbody>
              {points.slice(-8).map((point) => (
                <tr key={point.date}>
                  <td className="num">{point.date}</td>
                  <td className="num">{formatNum(point.a, 3)}</td>
                  <td className="num">{formatNum(point.b, 3)}</td>
                  <td className="num">{formatNum(point.r, 3)}</td>
                  <td className="num">
                    {point.s == null ? "—" : `${(point.s * 100).toFixed(2)}%`}
                  </td>
                  <td className="num">{formatNum(point.rsi, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
