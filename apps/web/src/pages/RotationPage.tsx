import type { RotationView } from "@quki/analytics";
import { findRotationPair, type RangeKey } from "@quki/types";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router";

import { AppHeader } from "../components/AppHeader.js";
import { RotationChart } from "../components/RotationChart.js";
import { fetchRotation } from "../lib/api.js";
import { formatAsOf, formatPct } from "../lib/format.js";

const RANGES: { value: RangeKey; label: string }[] = [
  { value: "1Y", label: "1年" },
  { value: "3Y", label: "3年" },
  { value: "5Y", label: "5年" },
  { value: "10Y", label: "10年" },
  { value: "MAX", label: "全部" },
];

function pairFor(totalReturn: boolean, benchmark: "a" | "all"): string {
  if (totalReturn) return benchmark === "a" ? "h00922-h20903" : "h00922-h00985";
  return benchmark === "a" ? "000922-930903" : "000922-000985";
}

function formatR(value: number | null): string {
  return value == null ? "—" : value.toFixed(3);
}

function formatRatio(value: number | null): string {
  return value == null ? "—" : value.toFixed(2);
}

function formatSpread(value: number | null): string {
  if (value == null) return "—";
  const pct = value * 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

export function RotationPage() {
  const { pairId } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const rangeParam = params.get("range");
  const range: RangeKey =
    rangeParam && RANGES.some((item) => item.value === rangeParam)
      ? (rangeParam as RangeKey)
      : "5Y";
  const pair = pairId ? findRotationPair(pairId) : undefined;
  const [view, setView] = useState<RotationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState(pairId ?? "");
  if (pairId && requestKey !== pairId) {
    setRequestKey(pairId);
    setView(null);
    setError(null);
  }

  useEffect(() => {
    if (!pairId || !pair) return;
    let cancelled = false;
    fetchRotation(pairId)
      .then((data) => {
        if (!cancelled) setView(data);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "轮动数据加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [pairId, pair]);

  if (!pairId) return <Navigate to={`/rotation/h00922-h20903?range=${range}`} replace />;
  if (!pair) {
    return (
      <>
        <AppHeader code="H30269" search="" activeNav="rotation" />
        <main className="page-main">
          <section className="card">
            <div className="state">
              未找到轮动组合
              <div>
                <Link className="text-btn" to="/rotation/h00922-h20903?range=5Y">
                  返回红利 vs 中证A股
                </Link>
              </div>
            </div>
          </section>
        </main>
      </>
    );
  }

  const benchmark: "a" | "all" = pair.b === "H00985" || pair.b === "000985" ? "all" : "a";
  const loading = view == null && error == null;

  function go(nextTr: boolean, nextBench: "a" | "all", nextRange: RangeKey) {
    navigate(`/rotation/${pairFor(nextTr, nextBench)}?range=${nextRange}`);
  }

  const latest = view?.latest;

  return (
    <>
      <AppHeader code="H30269" search="?period=W&range=5Y&vol=0" activeNav="rotation" />
      <div className="toolbar">
        <div className="seg" role="group" aria-label="口径">
          <button
            type="button"
            className={pair.totalReturn ? "active" : ""}
            onClick={() => go(true, benchmark, range)}
          >
            全收益
          </button>
          <button
            type="button"
            className={pair.totalReturn ? "" : "active"}
            onClick={() => go(false, benchmark, range)}
          >
            价格
          </button>
        </div>
        <div className="seg" role="group" aria-label="基准">
          <button
            type="button"
            className={benchmark === "a" ? "active" : ""}
            onClick={() => go(pair.totalReturn, "a", range)}
          >
            中证A股
          </button>
          <button
            type="button"
            className={benchmark === "all" ? "active" : ""}
            onClick={() => go(pair.totalReturn, "all", range)}
          >
            中证全指
          </button>
        </div>
        <div className="seg" role="group" aria-label="区间">
          {RANGES.map((item) => (
            <button
              key={item.value}
              type="button"
              className={range === item.value ? "active" : ""}
              onClick={() => go(pair.totalReturn, benchmark, item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="asof">
          数据截至{" "}
          {loading ? (
            <span
              className="skeleton"
              style={{ display: "inline-block", width: 120, height: 14 }}
            />
          ) : (
            <strong className="qk-tabular">{view ? formatAsOf(view.asOf) : "—"}</strong>
          )}{" "}
          北京时间
        </div>
      </div>
      <main className="page-main">
        <div className="hint" style={{ marginBottom: 12 }}>
          {pair.title} · <span className="qk-tabular">{pair.a}</span> /{" "}
          <span className="qk-tabular">{pair.b}</span>
          {pair.totalReturn ? " · 两端全收益" : " · 两端价格指数"}
        </div>
        {loading ? (
          <section className="card">
            <div className="skeleton" style={{ height: 880, margin: 16 }} />
          </section>
        ) : null}
        {error ? (
          <section className="card">
            <div className="state">
              轮动数据加载失败
              <div className="hint">{error}</div>
            </div>
          </section>
        ) : null}
        {latest && view ? (
          <>
            <div className="stat-grid">
              <section className="card stat-card">
                <div className="stat-label">相对强弱 R</div>
                <div className="stat-value qk-tabular">{formatR(latest.r)}</div>
                <div className="stat-sub">
                  <span className="badge badge-neutral">{latest.zone}</span>
                </div>
              </section>
              <section className="card stat-card">
                <div className="stat-label">布林 %B / 带宽</div>
                <div className="stat-value qk-tabular">{formatRatio(latest.pctB)}</div>
                <div className="stat-sub qk-tabular">
                  带宽 {latest.bandwidth == null ? "—" : formatPct(latest.bandwidth * 100)}
                  <br />
                  上轨 {formatR(latest.upper)} · 下轨 {formatR(latest.lower)}
                </div>
              </section>
              <section className="card stat-card">
                <div className="stat-label">40日收益差</div>
                <div className="stat-value qk-tabular">{formatSpread(latest.s)}</div>
                <div className="stat-sub qk-tabular">
                  历史分位 {latest.sPercentile == null ? "—" : `${Math.round(latest.sPercentile)}%`}
                </div>
              </section>
              <section className="card stat-card">
                <div className="stat-label">RSI14</div>
                <div className="stat-value qk-tabular">
                  {latest.rsi == null ? "—" : latest.rsi.toFixed(1)}
                </div>
                <div className="stat-sub">
                  MA242 {latest.rsiMa == null ? "—" : latest.rsiMa.toFixed(1)}
                  <br />
                  收益差均线穿 0：
                  {latest.lastSpreadCross
                    ? `${latest.lastSpreadCross.date} ${latest.lastSpreadCross.direction === "up" ? "上穿" : "下穿"}`
                    : "尚未出现"}
                </div>
              </section>
            </div>
            <section className="card">
              <div className="card-hd">
                <div className="card-title">轮动三棱镜</div>
              </div>
              <RotationChart view={view} range={range} />
            </section>
            <p className="rot-note">历史指标不保证未来，工具只负责呈现。</p>
          </>
        ) : null}
        <footer className="disc">
          <strong>免责声明：</strong>
          本站展示的指数行情与相对强弱仅供学习与研究参考，<strong>不构成投资建议</strong>
          。市场有风险，决策需独立判断。
        </footer>
      </main>
    </>
  );
}
