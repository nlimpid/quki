import type { TierLevel, TierRow } from "@quki/types";

import { ceilingTier, formatDistance, formatLevel } from "../lib/format.js";

const DOT: Record<TierLevel, string> = {
  85: "var(--qk-tier-85-solid)",
  90: "var(--qk-tier-90-solid)",
  95: "var(--qk-tier-95-solid)",
  100: "var(--qk-tier-100-solid)",
  105: "var(--qk-tier-105-solid)",
  110: "var(--qk-tier-110-solid)",
};

export function TierTable({ rows, lastClose }: { rows: TierRow[]; lastClose: number }) {
  const highlight = ceilingTier(rows, lastClose);
  return (
    <section className="card tier-card">
      <div className="card-hd">
        <div className="card-title">分档点位</div>
      </div>
      <div className="table-scroll">
        <table className="qk" style={{ minWidth: 320 }}>
          <thead>
            <tr>
              <th>档位</th>
              <th>含义</th>
              <th>点位</th>
              <th>距现价</th>
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
                <td>{row.label}</td>
                <td className="num">{formatLevel(row.level)}</td>
                <td className="num">{formatDistance(row.distancePct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
