import { Table } from "@heroui/react";
import type { CSSProperties } from "react";
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
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="分档点位">
              <Table.Header>
                <Table.Column isRowHeader>档位</Table.Column>
                <Table.Column>含义</Table.Column>
                <Table.Column>点位</Table.Column>
                <Table.Column>距现价</Table.Column>
                <Table.Column>历史分位</Table.Column>
                <Table.Column>次数</Table.Column>
                <Table.Column>最近</Table.Column>
              </Table.Header>
              <Table.Body>
                {rows.map((row) => (
                  <Table.Row
                    key={row.tier}
                    id={String(row.tier)}
                    className={row.tier === highlight ? "hl" : undefined}
                    style={
                      row.tier === highlight
                        ? ({ "--hl": DOT[row.tier] } as CSSProperties)
                        : undefined
                    }
                  >
                    <Table.Cell>
                      <i className="tier-dot" style={{ background: DOT[row.tier] }} />
                      {row.tier}%
                    </Table.Cell>
                    <Table.Cell className="tier-meaning">
                      <span className="tier-word">{row.label}</span>
                      {row.derived ? <span className="derived">派生</span> : null}
                    </Table.Cell>
                    <Table.Cell className="num">{formatLevel(row.level)}</Table.Cell>
                    <Table.Cell className="num">{formatDistance(row.distancePct)}</Table.Cell>
                    <Table.Cell className="num">{Math.round(row.ratioPercentile)}%</Table.Cell>
                    <Table.Cell className="num">
                      {row.episodeCount} 次 / {row.episodeWeeks} 周
                    </Table.Cell>
                    <Table.Cell className="num">{row.latestEpisode ?? "—"}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </div>
    </section>
  );
}
