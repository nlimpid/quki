import type { LowRow } from "@quki/types";

import { formatLevel, formatPct } from "../lib/format.js";

function Marks({ row }: { row: LowRow }) {
  return (
    <div className="marks">
      {row.tag !== "其他" ? (
        <span className={`badge ${row.tag === "史诗底" ? "badge-epic" : "badge-important"}`}>
          {row.tag}
        </span>
      ) : null}
      <span className={`badge ${row.confirmed ? "badge-neutral" : "badge-unconfirmed"}`}>
        {row.confirmed ? "已确认" : "未确认"}
      </span>
      {row.possiblyOpen ? <span className="badge badge-unconfirmed">未收盘</span> : null}
    </div>
  );
}

export function LowsTable({ rows }: { rows: LowRow[] }) {
  return (
    <section className="card lows-card">
      <div className="card-hd">
        <div className="card-title">显著低点</div>
        <div className="hint" style={{ marginTop: 0 }}>
          周低点/MA55 为 ±13 周最低且 &lt; 95%
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="state">暂无显著低点（需周低点/MA55 为 ±13 周最低且 &lt; 95%）</div>
      ) : (
        <>
          <div className="lows-table table-scroll">
            <table className="qk">
              <thead>
                <tr>
                  <th>周末日期</th>
                  <th>周低点</th>
                  <th>MA55</th>
                  <th>低点/MA55</th>
                  <th>标记</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.weekEnd} className={row.confirmed ? undefined : "unconfirmed"}>
                    <td className="num">{row.weekEnd}</td>
                    <td className="num">{formatLevel(row.weekLow)}</td>
                    <td className="num">{formatLevel(row.ma55)}</td>
                    <td className="num">{formatPct(row.ratioPct)}</td>
                    <td>
                      <Marks row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="lows-cards">
            {rows.map((row) => (
              <article
                key={row.weekEnd}
                className={row.confirmed ? "low-card" : "low-card unconfirmed"}
              >
                <div className="low-top">
                  <span className="low-date qk-tabular">{row.weekEnd}</span>
                  <span className="low-ratio qk-tabular">{formatPct(row.ratioPct)}</span>
                </div>
                <div className="low-meta">
                  <span>
                    周低点 <b className="qk-tabular">{formatLevel(row.weekLow)}</b>
                  </span>
                  <span>
                    MA55 <b className="qk-tabular">{formatLevel(row.ma55)}</b>
                  </span>
                </div>
                <Marks row={row} />
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
