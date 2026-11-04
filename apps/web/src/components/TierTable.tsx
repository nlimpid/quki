import type { TierLevel, TierRow } from "@quki/types";

import { ceilingTier, formatDistance, formatLevel } from "../lib/format.js";

const DOT: Record<TierLevel, string> = {
  85: "var(--qk-tier-85-solid)",
  90: "var(--qk-tier-90-solid)",
  95: "var(--qk-tier-95-solid)",
  100: "var(--qk-tier-100-solid)",
  105: "var(--qk-tier-105-solid)",
  110: "var(--qk-tier-110-solid)",
  115: "var(--qk-tier-115-solid)",
};

const TIER_HELP =
  "85%（史诗底）和 90%（重要底）来自既定规则。偏低、偏热、过热、顶部区域是派生标签。历史分位是该档位比值在全部周线收盘/MA55 中、严格更低的占比。次数把连续周合并为一次：低于 100% 的档统计跌破，高于 100% 的档统计升破，100% 统计连续低于均线。";

export function TierTable({ rows, lastClose }: { rows: TierRow[]; lastClose: number }) {
  const highlight = ceilingTier(rows, lastClose);
  return (
    <section className="card tier-card">
      <div className="card-hd">
        <div className="card-title">
          分档点位
          <button type="button" className="hint-btn" title={TIER_HELP} aria-label="分档统计说明">
            ?
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table className="qk" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th>档位</th>
              <th>含义</th>
              <th>点位</th>
              <th>距现价</th>
              <th>历史分位</th>
              <th>次数</th>
              <th>最近</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.tier}
                className={row.tier === highlight ? "hl" : undefined}
                style={{ ["--hl" as string]: DOT[row.tier] }}
              >
                <td>
                  <i className="tier-dot" style={{ background: DOT[row.tier] }} />
                  {row.tier}%
                </td>
                <td>
                  {row.label}
                  {row.derived ? <span className="derived">派生</span> : null}
                </td>
                <td className="num">{formatLevel(row.level)}</td>
                <td className="num">{formatDistance(row.distancePct)}</td>
                <td className="num">{Math.round(row.ratioPercentile)}%</td>
                <td className="num">
                  {row.episodeCount} 次 / {row.episodeWeeks} 周
                </td>
                <td className="num">{row.latestEpisode ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
