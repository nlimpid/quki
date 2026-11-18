import type { PortfolioDividendSummary } from "@quki/analytics";
import { Link } from "react-router";

import { formatCny, formatShares, formatYield, weightLabel } from "./stockFormat.js";

export type HoldingLayoutRow = {
  code: string;
  shares: number;
};

export type HoldingMetric = {
  name: string;
  exchange: string;
  price: number | null;
  quoteFresh: boolean;
  yieldPct: number | null;
  annual: number | null;
  missing: boolean;
};

/**
 * Account row chrome. Dividend figures render only when the caller passes `metrics`.
 */
export function HoldingBoard({
  rows,
  metrics = null,
  pendingDelete,
  onEdit,
  onDelete,
  deleteId,
}: {
  rows: readonly HoldingLayoutRow[];
  metrics?: {
    summary: PortfolioDividendSummary;
    byCode: ReadonlyMap<string, HoldingMetric>;
  } | null;
  pendingDelete: string | null;
  onEdit: (row: HoldingLayoutRow, source: HTMLElement) => void;
  onDelete: (code: string) => void;
  deleteId?: (code: string) => string | undefined;
}) {
  return (
    <>
      {metrics ? (
        <div className="summary-strip">
          <section className="div-card hero">
            <label>持仓只数</label>
            <div className="v mono">{metrics.summary.count}</div>
          </section>
          <section className="div-card hero">
            <label>组合平均股息率</label>
            <div className="v mono">{formatYield(metrics.summary.avgYieldPct)}</div>
            <p className="yield-note">{weightLabel(metrics.summary.weight)} · 税前</p>
          </section>
          <section className="div-card hero">
            <label>预估全年分红</label>
            <div className="v mono">{formatCny(metrics.summary.annualCashCny)}</div>
            <p className="yield-note">税前估算 · 非承诺</p>
          </section>
        </div>
      ) : null}
      <div className="hold-grid">
      {rows.map((row) => {
        const metric = metrics?.byCode.get(row.code);
        return (
        <article key={row.code} className="div-card hold-card">
          <div className="hold-top">
            <div>
              <Link to={`/stock/${row.code}`} style={{ fontWeight: 600, fontSize: 16 }}>
                {metric?.name ?? row.code}
              </Link>
              <div className="mono subdued">
                {metric?.exchange ? `${row.code}.${metric.exchange}` : row.code}
              </div>
            </div>
            <div>
              <button
                type="button"
                className="icon-text"
                aria-label="编辑"
                onClick={(event) => onEdit(row, event.currentTarget)}
              >
                ✎
              </button>
              <button
                type="button"
                className="icon-text"
                id={deleteId?.(row.code)}
                aria-label={pendingDelete === row.code ? "确认删除" : "删除"}
                onClick={() => onDelete(row.code)}
              >
                {pendingDelete === row.code ? "确认" : "×"}
              </button>
            </div>
          </div>
          <div className="hold-shares">
            持股 <span className="mono">{formatShares(row.shares)}</span> 股
          </div>
          {metric ? (
            <>
              <div className={metric.quoteFresh || metric.price == null ? "subdued" : "subdued quote-stale"}>
                最新价{" "}
                <span className="mono">
                  {metric.price == null
                    ? "—"
                    : metric.price.toLocaleString("zh-CN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                </span>
                {!metric.quoteFresh && metric.price != null ? " · 最近已知" : ""}
                {metric.missing ? " · 未找到行情" : ""}
              </div>
              <div className="hold-metric" style={{ marginTop: 12 }}>
                <label>平均股息率</label>
                <div className="v mono">{formatYield(metric.yieldPct)}</div>
              </div>
              <div className="hold-metric" style={{ marginTop: 10 }}>
                <label>预估全年分红</label>
                <div className="v mono">{formatCny(metric.annual)}</div>
              </div>
            </>
          ) : null}
        </article>
        );
      })}
    </div>
      {metrics ? (
        <p className="yield-note">
          平均股息率与列表「近12月股息率」同一口径：近12个自然月税前现金（每股，已按其后送转除权）÷
          最新收盘价。预估全年分红 = 持股数 × 该每股现金。送转不计入分子。
        </p>
      ) : null}
    </>
  );
}
