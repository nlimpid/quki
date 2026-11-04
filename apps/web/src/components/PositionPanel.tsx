import type { Overview } from "@quki/types";

import { formatLevel, formatPercentile, formatPct, positionZone } from "../lib/format.js";

export function PositionPanel({ overview }: { overview: Overview }) {
  const zone = positionZone(overview.ratioPct);
  const change = overview.changePct;
  return (
    <section className="card pos pos-card">
      <div className="pos-label">
        当前位置
        <span className={`badge badge-${zone.variant}`}>{zone.label}</span>
        {overview.weekPossiblyOpen ? (
          <span className="badge badge-unconfirmed">当周未收盘</span>
        ) : null}
      </div>
      <div className="hero qk-tabular">{formatPct(overview.ratioPct)}</div>
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
      <div className="pct-label">
        <span>历史分位</span>
        <span className="qk-tabular">{formatPercentile(overview.percentile)}</span>
      </div>
      <div className="meter" aria-hidden="true">
        <i style={{ width: `${Math.min(100, Math.max(0, Math.round(overview.percentile)))}%` }} />
      </div>
      <div className="hint">
        分位越低表示相对越便宜。当前周收盘/MA55 高于全历史 {overview.percentileSample} 个样本中的{" "}
        {formatPercentile(overview.percentile)}。
      </div>
    </section>
  );
}
