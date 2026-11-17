import type { RotationView } from "@quki/analytics";
import { PHASE1_INSTRUMENTS, findRotationPair, type Candle, type Overview } from "@quki/types";
import { useState } from "react";

import { AppHeader } from "../components/AppHeader.js";
import { KlineChart } from "../components/KlineChart.js";
import { RotationChart } from "../components/RotationChart.js";

const DATES = ["2024-01-05", "2024-01-12", "2024-01-19", "2024-01-26", "2024-02-02"];

/** Labeled sample. Not a market response and not derived from the fixture API. */
const candles: Candle[] = [
  { time: DATES[0]!, open: 10, high: 12, low: 9, close: 11, volume: 120000000 },
  { time: DATES[1]!, open: 11, high: 11.5, low: 10.2, close: 10.4, volume: null },
  { time: DATES[2]!, open: null, high: null, low: null, close: 10.8, volume: 250000000 },
  { time: DATES[3]!, open: null, high: null, low: null, close: 10.6, volume: null },
  { time: DATES[4]!, open: 10.6, high: 11.2, low: 10.1, close: 11, volume: 30000 },
];

const instrument = PHASE1_INSTRUMENTS[0]!;

const overview: Overview = {
  instrument,
  asOf: "2024-02-02T15:00:00+08:00",
  weekPossiblyOpen: false,
  lastClose: 11,
  previousClose: 10.6,
  changePct: 3.77,
  ma55: 10,
  ratioPct: 110,
  percentile: 80,
  percentileSample: 5,
  tiers: [],
  lows: [
    {
      weekEnd: DATES[0]!,
      weekLow: 9,
      ma55: 10,
      ratioPct: 90,
      confirmed: true,
      possiblyOpen: false,
      tag: "重要底",
    },
    {
      weekEnd: DATES[2]!,
      weekLow: 10.8,
      ma55: 10,
      ratioPct: 108,
      confirmed: false,
      possiblyOpen: false,
      tag: "其他",
    },
  ],
  daily: candles,
  weekly: candles,
  ma55Weekly: DATES.map((time) => ({ time, value: 10 })),
  temperature: {
    value: 42,
    tradeDate: DATES[4]!,
    asOf: "2024-02-02T15:00:00+08:00",
    method: "quantile_blend",
    version: 1,
    pa: 1,
    pb: 1,
    spread40: 0,
    band: "neutral",
  },
};

const pair = findRotationPair("h00922-h20903")!;

const rotation: RotationView = {
  pair,
  asOf: "2024-02-02T15:00:00+08:00",
  latest: {
    date: DATES[4]!,
    r: 1.5,
    ma: 1.5,
    upper: 2,
    lower: 1,
    pctB: 0.5,
    bandwidth: 1,
    s: 0,
    sPercentile: 50,
    rsi: 50,
    rsiMa: 50,
    zone: "轨道内",
    lastSpreadCross: null,
  },
  points: DATES.map((date, index) => ({
    date,
    a: 1 + index * 0.1,
    b: 1 + index * 0.05,
    r: 1.5,
    ma: 1.5,
    upper: 2,
    lower: 1,
    s: index < 3 ? -0.02 : 0.02,
    sMa: 0,
    rsi: 40 + index,
    rsiMa: 45,
  })),
  markers: [
    { date: DATES[1]!, kind: "band-above", label: "突破上轨", value: 1.5 },
    { date: DATES[2]!, kind: "spread-up", label: "上穿", value: 0 },
    { date: DATES[3]!, kind: "spread-extreme", label: "90%分位", value: 0.02 },
  ],
};

export function ChartFixturePage() {
  const [showVolume, setShowVolume] = useState(true);
  return (
    <>
      <AppHeader activeNav="index" />
      <main className="page-main">
        <p className="chart-key" data-fixture="chart">
          样例数据，不是行情接口。第1、2、5根有开高低收，第3、4根只有收盘。成交量分别是有、无、有、无、有，和
          K 线是否完整无关。
        </p>
        <KlineChart
          overview={overview}
          period="W"
          range="MAX"
          showVolume={showVolume}
          onToggleVolume={setShowVolume}
        />
        <section className="card">
          <div className="card-hd">
            <div className="card-title">轮动样例 · 轨道填充</div>
          </div>
          <RotationChart view={rotation} range="MAX" />
        </section>
      </main>
    </>
  );
}
