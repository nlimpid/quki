import { Link } from "react-router";

import { formatShares } from "./stockFormat.js";

export type HoldingLayoutRow = {
  code: string;
  shares: number;
};

/**
 * Account row chrome only. Quote figures and the dividend summary are not rendered here.
 */
export function HoldingBoard({
  rows,
  pendingDelete,
  onEdit,
  onDelete,
  deleteId,
}: {
  rows: readonly HoldingLayoutRow[];
  pendingDelete: string | null;
  onEdit: (row: HoldingLayoutRow, source: HTMLElement) => void;
  onDelete: (code: string) => void;
  deleteId?: (code: string) => string | undefined;
}) {
  return (
    <div className="hold-grid">
      {rows.map((row) => (
        <article key={row.code} className="div-card hold-card">
          <div className="hold-top">
            <div>
              <Link to={`/stock/${row.code}`} style={{ fontWeight: 600, fontSize: 16 }}>
                {row.code}
              </Link>
              <div className="mono subdued">{row.code}</div>
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
        </article>
      ))}
    </div>
  );
}
