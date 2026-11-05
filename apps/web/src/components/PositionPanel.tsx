import type { Overview, TemperatureBand } from "@quki/types";

import {
  formatLevel,
  formatPercentile,
  formatPct,
  positionZone,
  temperatureBandLabel,
} from "../lib/format.js";

function tempBadge(band: TemperatureBand): string {
  if (band === "extreme_cold" || band === "cold") return "badge-cold";
  if (band === "hot" || band === "extreme_hot") return "badge-hot";
  return "badge-neutral";
}

export function PositionPanel({ overview }: { overview: Overview }) {
  const zone = positionZone(overview.ratioPct);
  const change = overview.changePct;
  const temperature = overview.temperature;
  return (
    <section className="card pos pos-card">
      <div className="pos-block">
        <div className="pos-kicker">温度</div>
        <div className="pos-head">
          <div className="hero qk-tabular">{temperature ? temperature.value : "—"}</div>
          {temperature ? (
            <span className={`badge ${tempBadge(temperature.band)}`}>
              {temperatureBandLabel(temperature.band)}
            </span>
          ) : (
            <span className="badge badge-neutral">尚未更新</span>
          )}
        </div>
        <div className="hero-sub">0–100 · 高表示贵</div>
      </div>

      <div className="pos-block">
        <div className="pct-label">
          <span>概率 · 历史分位</span>
          <span className="qk-tabular">{formatPercentile(overview.percentile)}</span>
        </div>
        <div className="meter" aria-hidden="true">
          <i style={{ width: `${Math.min(100, Math.max(0, Math.round(overview.percentile)))}%` }} />
        </div>
        <div className="hint">
          {temperature
            ? `自身分位 P_A ${temperature.pa.toFixed(1)}% · 40 日相对分位 P_B ${temperature.pb.toFixed(1)}%`
            : `当前周收盘/MA55 高于全历史 ${overview.percentileSample} 个样本中的 ${formatPercentile(overview.percentile)}。`}
        </div>
      </div>

      <div className="pos-block">
        <div className="pos-kicker">区间</div>
        <div className="pos-head">
          <div className="range-num qk-tabular">{formatPct(overview.ratioPct)}</div>
          <span className={`badge badge-${zone.variant}`}>{zone.label}</span>
          {overview.weekPossiblyOpen ? (
            <span className="badge badge-unconfirmed">当周未收盘</span>
          ) : null}
        </div>
        <div className="hero-sub">收盘 / MA55</div>
        <div className="meta-row">
          <span>
            收盘 <b className="qk-tabular">{formatLevel(overview.lastClose)}</b>
          </span>
          <span>
            MA55 <b className="qk-tabular">{formatLevel(overview.ma55)}</b>
          </span>
          {change != null ? (
            <span className={change > 0 ? "change-up" : change < 0 ? "change-down" : ""}>
              日涨跌 <b className="qk-tabular">{formatPct(change)}</b>
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
