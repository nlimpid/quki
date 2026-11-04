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
        setError(reason instanceof Error ? reason.message : "行情加载失败");
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

  if (loading) {
    return (
      <div className="layout-grid">
        <section className="card chart-card">
          <div className="skeleton" style={{ height: "var(--qk-chart-h)", margin: 16 }} />
        </section>
        <div className="rail">
          <section className="card pos">
            <div className="skeleton" style={{ height: 18, width: 80, marginBottom: 12 }} />
            <div className="skeleton" style={{ height: 36, width: 120 }} />
          </section>
        </div>
      </div>
    );
  }

  if (error || !overview) {
    return (
      <section className="card">
        <div className="state">
          行情加载失败
          <div className="hint">{error}</div>
          <button
            type="button"
            className="text-btn"
            onClick={() => setAttempt((value) => value + 1)}
          >
            重试
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="layout-grid">
      <Suspense
        fallback={
          <section className="card chart-card">
            <div className="skeleton" style={{ height: "var(--qk-chart-h)", margin: 16 }} />
          </section>
        }
      >
        <KlineChart
          overview={overview}
          period={period}
          range={range}
          showVolume={showVolume}
          onToggleVolume={(value) => {
            const next = new URLSearchParams(params);
            next.set("vol", value ? "1" : "0");
            setParams(next);
          }}
        />
      </Suspense>
      <div className="rail">
        <PositionPanel overview={overview} />
        <TierTable rows={overview.tiers} lastClose={overview.lastClose} />
      </div>
      <LowsTable rows={overview.lows} />
    </div>
  );
}
