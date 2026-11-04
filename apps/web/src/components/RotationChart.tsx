import type { RotationView } from "@quki/analytics";
import type { RangeKey } from "@quki/types";
import { LineChart, ScatterChart } from "echarts/charts";
import {
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useMemo, useRef } from "react";

import { rangeStart } from "../lib/format.js";
import { useTheme } from "../lib/theme.js";

echarts.use([
  LineChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  DataZoomComponent,
  MarkLineComponent,
  TitleComponent,
  CanvasRenderer,
]);

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function RotationChart({ view, range }: { view: RotationView; range: RangeKey }) {
  const host = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
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
    void theme;
    const chart = echarts.init(el, undefined, { renderer: "canvas" });
    const text = cssVar("--qk-text-primary");
    const secondary = cssVar("--qk-text-secondary");
    const axis = cssVar("--qk-chart-axis");
    const grid = cssVar("--qk-chart-grid");
    const blue = cssVar("--qk-brand-accent");
    const red = cssVar("--qk-market-up");
    const band = cssVar("--qk-brand-accent-muted");
    const font = cssVar("--qk-font-sans");
    const mono = cssVar("--qk-font-tabular");
    const dates = points.map((point) => point.date);
    const row = 190;
    const step = 224;
    const titles = ["累计收益", "相对强弱 R", "40日收益差", "RSI14"];

    chart.setOption({
      animation: false,
      textStyle: { fontFamily: font, color: text },
      axisPointer: { link: [{ xAxisIndex: "all" }], lineStyle: { type: "dashed" } },
      title: titles.map((title, index) => ({
        text: title,
        top: index * step,
        left: 8,
        textStyle: { fontSize: 13, fontWeight: 600, color: text, fontFamily: font },
      })),
      tooltip: {
        trigger: "axis",
        backgroundColor: cssVar("--qk-chart-tooltip-bg"),
        borderColor: cssVar("--qk-chart-tooltip-border"),
        textStyle: { color: text, fontSize: 12, fontFamily: mono },
      },
      dataZoom: [{ type: "inside", xAxisIndex: [0, 1, 2, 3] }],
      grid: [0, 1, 2, 3].map((index) => ({
        left: 64,
        right: 16,
        top: 28 + index * step,
        height: row,
      })),
      xAxis: [0, 1, 2, 3].map((index) => ({
        type: "category",
        data: dates,
        gridIndex: index,
        axisLabel: {
          show: index === 3,
          color: axis,
          fontSize: 11,
          fontFamily: mono,
          hideOverlap: true,
        },
        axisLine: { lineStyle: { color: grid } },
        splitLine: { show: false },
      })),
      yAxis: [
        {
          gridIndex: 0,
          scale: true,
          axisLabel: { color: axis, fontSize: 11, fontFamily: mono },
          splitLine: { lineStyle: { color: grid } },
        },
        {
          gridIndex: 1,
          scale: true,
          axisLabel: { color: axis, fontSize: 11, fontFamily: mono },
          splitLine: { lineStyle: { color: grid } },
        },
        {
          gridIndex: 2,
          scale: true,
          axisLabel: {
            color: axis,
            fontSize: 11,
            fontFamily: mono,
            formatter: (value: number) => `${(value * 100).toFixed(0)}%`,
          },
          splitLine: { lineStyle: { color: grid } },
        },
        {
          gridIndex: 3,
          min: 0,
          max: 100,
          axisLabel: { color: axis, fontSize: 11, fontFamily: mono },
          splitLine: { lineStyle: { color: grid } },
        },
      ],
      series: [
        {
          name: view.pair.aName,
          type: "line",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: points.map((point) => point.a),
          showSymbol: false,
          lineStyle: { width: 1.5, color: blue },
          itemStyle: { color: blue },
        },
        {
          name: view.pair.bName,
          type: "line",
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: points.map((point) => point.b),
          showSymbol: false,
          lineStyle: { width: 1.25, type: "dashed", color: secondary },
          itemStyle: { color: secondary },
        },
        {
          name: "下轨",
          type: "line",
          xAxisIndex: 1,
          yAxisIndex: 1,
          stack: "band",
          data: points.map((point) => point.lower),
          showSymbol: false,
          lineStyle: { opacity: 0 },
          areaStyle: { opacity: 0 },
          tooltip: { show: false },
        },
        {
          name: "轨道",
          type: "line",
          xAxisIndex: 1,
          yAxisIndex: 1,
          stack: "band",
          data: points.map((point) =>
            point.upper == null || point.lower == null ? null : point.upper - point.lower,
          ),
          showSymbol: false,
          lineStyle: { opacity: 0 },
          areaStyle: { color: band, opacity: 0.9 },
          tooltip: { show: false },
        },
        {
          name: "R",
          type: "line",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: points.map((point) => point.r),
          showSymbol: false,
          z: 3,
          lineStyle: { width: 1.5, color: blue },
          itemStyle: { color: blue },
        },
        {
          name: "MA242",
          type: "line",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: points.map((point) => point.ma),
          showSymbol: false,
          z: 3,
          lineStyle: { width: 1.25, color: red },
          itemStyle: { color: red },
        },
        {
          name: "收益差",
          type: "line",
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: points.map((point) => point.s),
          showSymbol: false,
          lineStyle: { width: 1.25, color: text },
          itemStyle: { color: text },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { type: "dashed", color: axis },
            data: [{ yAxis: 0 }],
            label: { show: false },
          },
        },
        {
          name: "MA242(收益差)",
          type: "line",
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: points.map((point) => point.sMa),
          showSymbol: false,
          lineStyle: { width: 1.25, type: "dashed", color: red },
          itemStyle: { color: red },
        },
        {
          name: "RSI14",
          type: "line",
          xAxisIndex: 3,
          yAxisIndex: 3,
          data: points.map((point) => point.rsi),
          showSymbol: false,
          lineStyle: { width: 1.5, color: cssVar("--qk-brand-primary") },
          itemStyle: { color: cssVar("--qk-brand-primary") },
        },
        {
          name: "MA242(RSI)",
          type: "line",
          xAxisIndex: 3,
          yAxisIndex: 3,
          data: points.map((point) => point.rsiMa),
          showSymbol: false,
          lineStyle: { width: 1.25, type: "dashed", color: red },
          itemStyle: { color: red },
        },
        {
          name: "轨道穿越",
          type: "scatter",
          xAxisIndex: 1,
          yAxisIndex: 1,
          z: 5,
          data: markers
            .filter((marker) => marker.kind === "band-above" || marker.kind === "band-below")
            .map((marker) => ({
              value: [marker.date, marker.value],
              symbol: "triangle",
              symbolRotate: marker.kind === "band-below" ? 180 : 0,
              symbolSize: 9,
              itemStyle: { color: marker.kind === "band-above" ? red : cssVar("--qk-market-down") },
            })),
        },
        {
          name: "均线穿零",
          type: "scatter",
          xAxisIndex: 2,
          yAxisIndex: 2,
          z: 5,
          data: markers
            .filter((marker) => marker.kind === "spread-up" || marker.kind === "spread-down")
            .map((marker) => ({
              value: [marker.date, marker.value],
              symbol: "circle",
              symbolSize: 8,
              itemStyle: { color: red },
            })),
        },
        {
          name: "收益差极值",
          type: "scatter",
          xAxisIndex: 2,
          yAxisIndex: 2,
          z: 5,
          data: markers
            .filter((marker) => marker.kind === "spread-extreme")
            .map((marker, index, all) => ({
              value: [marker.date, marker.value],
              symbol: "diamond",
              symbolSize: 8,
              label: {
                show: index >= all.length - 3,
                formatter: marker.label,
                fontSize: 10,
                color: secondary,
                position: "top",
              },
              itemStyle: { color: cssVar("--qk-warning") },
            })),
        },
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [points, markers, theme, view.pair.aName, view.pair.bName]);

  return <div ref={host} className="rot-chart" role="img" aria-label="轮动三棱镜四图" />;
}
