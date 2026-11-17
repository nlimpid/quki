import type { Overview, Period, RangeKey } from "@quki/types";
import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router";

const KlineChart = lazy(() =>
  import("../components/KlineChart.js").then((mod) => ({ default: mod.KlineChart })),
);
import { LowsTable } from "../components/LowsTable.js";
import { PositionPanel } from "../components/PositionPanel.js";
import { TierTable } from "../components/TierTable.js";
import { fetchOverview } from "../lib/api.js";

const RANGES = new Set<RangeKey>(["1Y", "3Y", "5Y", "10Y", "MAX"]);

function ChartPending() {
  return (
    <section className="chart-panel" aria-busy="true">
      <div className="chart-loading">加载中</div>
    </section>
  );
}

export function OverviewPage({
  onOverview,
}: {
  onOverview: (overview: Overview | null, loading: boolean) => void;
}) {
  const { code = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const period: Period = params.get("period") === "D" ? "D" : "W";
  const rangeParam = params.get("range");
  const range: RangeKey =
    rangeParam && RANGES.has(rangeParam as RangeKey) ? (rangeParam as RangeKey) : "5Y";
  const showVolume = params.get("vol") === "1";
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [requestKey, setRequestKey] = useState(`${code}:0`);
  const key = `${code}:${attempt}`;
  if (requestKey !== key) {
    setRequestKey(key);
    setOverview(null);
    setError(null);
  }
  const loading = overview === null && error === null;

  useEffect(() => {
    let cancelled = false;
    onOverview(null, true);
    fetchOverview(code)
      .then((data) => {
        if (cancelled) return;
        setOverview(data);
        onOverview(data, false);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "数据暂时无法加载");
        onOverview(null, false);
      });
    return () => {
      cancelled = true;
    };
  }, [code, attempt, onOverview]);

  if (!params.get("period") || !params.get("range") || !params.get("vol")) {
    const next = new URLSearchParams(params);
    if (!next.get("period")) next.set("period", "W");
    if (!next.get("range")) next.set("range", "5Y");
    if (!next.get("vol")) next.set("vol", "0");
    return <Navigate to={`?${next.toString()}`} replace />;
  }

  function setPeriod(nextPeriod: Period) {
    const next = new URLSearchParams(params);
    next.set("period", nextPeriod);
    setParams(next);
  }

  function setRange(nextRange: RangeKey) {
    const next = new URLSearchParams(params);
    next.set("range", nextRange);
    setParams(next);
  }

  if (loading) {
    return (
      <div className="index-stack" aria-busy="true">
        <section className="judgment" aria-hidden="true">
          <div className="temp-block">
            <div className="skeleton temp-skel" />
            <div className="skeleton meter-skel" />
          </div>
          <div className="skeleton stat-skel" />
          <div className="skeleton stat-skel" />
          <div className="disclose">
            <div className="skeleton disclose-skel" />
            <div className="skeleton disclose-skel" />
            <div className="skeleton disclose-skel" />
          </div>
        </section>
        <ChartPending />
      </div>
    );
  }

  if (error || !overview) {
    return (
      <section className="index-error">
        <p>数据暂时无法加载</p>
        <button type="button" className="text-btn" onClick={() => setAttempt((value) => value + 1)}>
          重试
        </button>
      </section>
    );
  }

  return (
    <div className="index-stack">
      <PositionPanel overview={overview} />
      <Suspense fallback={<ChartPending />}>
        <KlineChart
          overview={overview}
          period={period}
          range={range}
          showVolume={showVolume}
          onPeriod={setPeriod}
          onRange={setRange}
          onToggleVolume={(value) => {
            const next = new URLSearchParams(params);
            next.set("vol", value ? "1" : "0");
            setParams(next);
          }}
        />
      </Suspense>
      <TierTable rows={overview.tiers} lastClose={overview.lastClose} />
      <LowsTable rows={overview.lows} />
    </div>
  );
}
