import { Axis, Crosshair, Tooltip, XYContainer } from "@unovis/ts";
import "@unovis/ts/styles";
import { Button } from "@heroui/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { CandleSeries } from "./CandleSeries.js";
import { sampleOhlc, type SampleBar } from "./sampleOhlc.js";
import { VolumeSeries } from "./VolumeSeries.js";
import "./proof.css";

const ALL = sampleOhlc();
const MARGIN = { top: 12, right: 16, bottom: 28, left: 56 };

function sliceOf(start: number, count: number): SampleBar[] {
  return ALL.slice(start, start + count).map((bar, i) => ({ ...bar, i }));
}

export function UnovisCandleProof() {
  const priceHost = useRef<HTMLDivElement>(null);
  const volumeHost = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState(40);
  const [count, setCount] = useState(40);
  const [hover, setHover] = useState<SampleBar | null>(null);
  const [align, setAlign] = useState("尚未测量");
  const bars = useMemo(() => sliceOf(start, count), [start, count]);

  useEffect(() => {
    const priceEl = priceHost.current;
    const volumeEl = volumeHost.current;
    if (!priceEl || !volumeEl) return;
    const x = (bar: SampleBar) => bar.i;
    const candles = new CandleSeries({ x, up: "#dc2626", down: "#15803d" });
    const volume = new VolumeSeries({ x });
    const price = new XYContainer<SampleBar>(
      priceEl,
      {
        height: 320,
        duration: 0,
        autoMargin: false,
        margin: MARGIN,
        ariaLabel: "示例 OHLC，不是行情",
        components: [candles],
        xAxis: new Axis({ type: "x", numTicks: 6, gridLine: false, tickFormat: (value) => bars[Math.round(Number(value))]?.time.slice(5) ?? "" }),
        yAxis: new Axis({ type: "y", numTicks: 5 }),
        crosshair: new Crosshair({
          x,
          y: (bar) => bar.close,
          template: (bar) => `${bar.time} 开${bar.open} 高${bar.high} 低${bar.low} 收${bar.close} 量${bar.volume}`,
        }),
        tooltip: new Tooltip(),
      },
      bars,
    );
    const volumes = new XYContainer<SampleBar>(
      volumeEl,
      {
        height: 96,
        duration: 0,
        autoMargin: false,
        margin: { ...MARGIN, bottom: 8 },
        ariaLabel: "示例成交量，与上方 K 线同一索引",
        components: [volume],
        yAxis: new Axis({ type: "y", numTicks: 2, gridLine: false }),
      },
      bars,
    );
    const measure = () => {
      const wick = priceEl.querySelector(".wick");
      const vol = volumeEl.querySelector(".vol");
      if (!(wick instanceof SVGLineElement) || !(vol instanceof SVGRectElement)) {
        setAlign("没有画出影线或成交量");
        return;
      }
      const wickBox = wick.getBoundingClientRect();
      const volBox = vol.getBoundingClientRect();
      const delta = Math.abs(wickBox.x + wickBox.width / 2 - (volBox.x + volBox.width / 2));
      setAlign(`首根影线与成交量中心相差 ${delta.toFixed(1)} px`);
    };
    requestAnimationFrame(measure);
    return () => {
      price.destroy();
      volumes.destroy();
    };
  }, [bars]);

  function zoom(nextCount: number, anchor: number) {
    const clamped = Math.max(12, Math.min(ALL.length, Math.round(nextCount)));
    const ratio = anchor / Math.max(1, count);
    const nextStart = Math.max(0, Math.min(ALL.length - clamped, Math.round(start + count * ratio - clamped * ratio)));
    setCount(clamped);
    setStart(nextStart);
  }

  function pan(deltaBars: number) {
    setStart((value) => Math.max(0, Math.min(ALL.length - count, value + deltaBars)));
  }

  return (
    <main className="proof">
      <p className="proof-banner">示例数据，不是行情接口。这页只验证 Unovis 能否画出 K 线。</p>
      <h1>Unovis OHLC 可行性</h1>
      <p>
        影线和实体由本仓库的 <code>CandleSeries</code> 绘制，它继承已发布的 <code>XYComponentCore</code>。
        成交量是另一个同类组件。缩放和平移是这页自己的窗口，不是 Unovis 自带的 XY 缩放。
      </p>
      <p data-proof="alignment">{align}</p>
      <p data-proof="window">
        窗口 {start + 1}–{start + bars.length} / {ALL.length}，悬停 {hover ? hover.time : "无"}
      </p>
      <div
        className="proof-chart"
        onWheel={(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const anchor = ((event.clientX - rect.left - MARGIN.left) / Math.max(1, rect.width - MARGIN.left - MARGIN.right)) * count;
          zoom(count * (event.deltaY > 0 ? 1.2 : 0.8), anchor);
        }}
        onPointerDown={(event) => {
          if (event.currentTarget.setPointerCapture) {
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // Synthetic and some touch sequences still pan through the dataset flag.
            }
          }
          event.currentTarget.dataset.dragging = "1";
          event.currentTarget.dataset.x = String(event.clientX);
        }}
        onPointerMove={(event) => {
          const rect = priceHost.current?.getBoundingClientRect();
          if (rect) {
            const ratio = (event.clientX - rect.left - MARGIN.left) / Math.max(1, rect.width - MARGIN.left - MARGIN.right);
            const index = Math.max(0, Math.min(bars.length - 1, Math.round(ratio * (bars.length - 1))));
            setHover(bars[index] ?? null);
          }
          if (event.currentTarget.dataset.dragging !== "1") return;
          const last = Number(event.currentTarget.dataset.x ?? event.clientX);
          const shift = Math.round((last - event.clientX) / 12);
          if (shift !== 0) {
            pan(shift);
            event.currentTarget.dataset.x = String(event.clientX);
          }
        }}
        onPointerUp={(event) => {
          event.currentTarget.dataset.dragging = "0";
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
      >
        <div ref={priceHost} data-proof="price" />
        <div ref={volumeHost} data-proof="volume" />
      </div>
      {hover ? (
        <p data-proof="ohlcv">
          {hover.time} 开 {hover.open} 高 {hover.high} 低 {hover.low} 收 {hover.close} 量 {hover.volume}
        </p>
      ) : (
        <p data-proof="ohlcv">把指针移到图上查看开高低收量。</p>
      )}
      <Button variant="primary" onPress={() => zoom(40, count / 2)}>
        HeroUI 按钮 · 重置窗口
      </Button>
    </main>
  );
}
