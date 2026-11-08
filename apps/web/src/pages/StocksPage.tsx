import type { StockListItem, StockListResponse, StockMarketFilter, StockSort } from "@quki/types";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { fetchStockList, parseMarket, parseSort } from "../lib/stockApi.js";
import { formatBeijing, formatPer10, formatPrice, formatYield } from "../lib/stockFormat.js";
import { DividendShell } from "./DividendShell.js";

const MARKETS: { id: StockMarketFilter; label: string }[] = [
  { id: "ALL", label: "全部" },
  { id: "SH", label: "上海" },
  { id: "SZ", label: "深圳" },
];

export function StocksPage() {
  const [params, setParams] = useSearchParams();
  const market = parseMarket(params.get("market"));
  const sort = parseSort(params.get("sort"));
  const page = Math.max(1, Number(params.get("page")) || 1);
  const q = params.get("q") ?? "";
  const [attempt, setAttempt] = useState(0);
  const request = `${q}|${market}|${sort}|${page}|${attempt}`;
  const [draft, setDraft] = useState(q);
  const [syncedQ, setSyncedQ] = useState(q);
  if (syncedQ !== q) {
    setSyncedQ(q);
    setDraft(q);
  }
  const [data, setData] = useState<StockListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [seenRequest, setSeenRequest] = useState(request);
  if (seenRequest !== request) {
    setSeenRequest(request);
    setError(null);
  }
  const loading = loadedKey !== request && error === null;

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (draft === q) return;
      const next = new URLSearchParams();
      if (draft) next.set("q", draft);
      if (market !== "ALL") next.set("market", market);
      if (sort !== "code") next.set("sort", sort);
      setParams(next, { replace: true });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [draft, q, market, sort, setParams]);

  useEffect(() => {
    const cancelled = { current: false };
    const key = `${q}|${market}|${sort}|${page}|${attempt}`;
    fetchStockList({ q, market, sort, page, pageSize: 50 })
      .then((body) => {
        if (cancelled.current) return;
        setData(body);
        setLoadedKey(key);
      })
      .catch((reason: unknown) => {
        if (cancelled.current) return;
        setError(reason instanceof Error ? reason.message : "列表加载失败");
        setLoadedKey(key);
      });
    return () => {
      cancelled.current = true;
    };
  }, [q, market, sort, page, attempt]);

  function setQuery(patch: { market?: StockMarketFilter; sort?: StockSort; page?: number }) {
    const next = new URLSearchParams(params);
    if (patch.market) {
      if (patch.market === "ALL") next.delete("market");
      else next.set("market", patch.market);
      next.delete("page");
    }
    if (patch.sort) {
      if (patch.sort === "code") next.delete("sort");
      else next.set("sort", patch.sort);
      next.delete("page");
    }
    if (patch.page) {
      if (patch.page <= 1) next.delete("page");
      else next.set("page", String(patch.page));
    }
    setParams(next);
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 50;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <DividendShell activeNav="stocks">
      <div className="page-head">
        <div>
          <h1 className="page-title">
            个股股息
            {data?.isSample ? <span className="sample-pill">示例数据</span> : null}
          </h1>
          <p className="page-sub">沪深 A 股（主板、创业板、科创板）· 不含北交所、ETF 与退市</p>
        </div>
        <div className="asof">
          数据截至 <span className="mono">{formatBeijing(data?.asOf)}</span> 北京时间
        </div>
      </div>
      <div className="div-toolbar">
        <label className="div-search">
          <span aria-hidden="true">⌕</span>
          <input
            value={draft}
            placeholder="搜索代码 / 名称"
            aria-label="搜索代码 / 名称"
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <div className="chips" role="group" aria-label="市场">
          {MARKETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={market === item.id ? "chip active" : "chip"}
              aria-pressed={market === item.id}
              onClick={() => setQuery({ market: item.id })}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="count-label">
          共 <span className="mono">{total.toLocaleString("zh-CN")}</span> 家
        </span>
      </div>
      <section className="div-card">
        {loading ? (
          <div>
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="skeleton skel-row" />
            ))}
          </div>
        ) : null}
        {!loading && error ? (
          <div className="state-block">
            列表加载失败
            <div>
              <button
                type="button"
                className="btn"
                onClick={() => setAttempt((value) => value + 1)}
              >
                重试
              </button>
            </div>
          </div>
        ) : null}
        {!loading && !error && items.length === 0 ? (
          <div className="state-block">
            没有匹配的股票
            {q ? (
              <div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setDraft("");
                    const next = new URLSearchParams(params);
                    next.delete("q");
                    next.delete("page");
                    setParams(next);
                  }}
                >
                  清空搜索
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {!loading && !error && items.length > 0 ? (
          <>
            <div className="div-table-wrap list-table">
              <table className="div-table">
                <thead>
                  <tr>
                    <SortableHead
                      label="代码"
                      sort="code"
                      active={sort}
                      onSort={(next) => setQuery({ sort: next })}
                    />
                    <th>名称</th>
                    <th className="num">最新价</th>
                    <SortableHead
                      label="近12月股息率"
                      sort="yield"
                      active={sort}
                      align="right"
                      onSort={(next) => setQuery({ sort: next })}
                    />
                    <SortableHead
                      label="最近除权日"
                      sort="lastDivDate"
                      active={sort}
                      align="right"
                      onSort={(next) => setQuery({ sort: next })}
                    />
                    <th className="num">每10股派息</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.code}>
                      <td className="mono">
                        <Link to={`/stock/${item.code}`}>{item.code}</Link>
                      </td>
                      <td>
                        <Link to={`/stock/${item.code}`}>{item.name}</Link>{" "}
                        <span className="subdued">{item.exchange}</span>
                      </td>
                      <PriceCell item={item} />
                      <td className="num mono">{formatYield(item.trailingYieldPct)}</td>
                      <td className="num mono subdued">{item.lastCashDivDate ?? "—"}</td>
                      <td className="num mono">{formatPer10(item.lastCashPer10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="stock-cards">
              {items.map((item) => (
                <Link key={item.code} className="stock-card" to={`/stock/${item.code}`}>
                  <div className="stock-card-top">
                    <strong>
                      {item.name} <span className="mono subdued">{item.code}</span>
                    </strong>
                    <span className={item.quoteFresh ? "mono" : "mono quote-stale"}>
                      {formatPrice(item.lastClose)}
                    </span>
                  </div>
                  <div className="subdued">
                    除权 <span className="mono">{item.lastCashDivDate ?? "—"}</span>
                    {" · "}
                    股息率 <span className="mono">{formatYield(item.trailingYieldPct)}</span>
                    {" · "}
                    每10股 <span className="mono">{formatPer10(item.lastCashPer10)}</span>
                  </div>
                </Link>
              ))}
            </div>
            <p className="yield-note" style={{ padding: "4px 16px 12px" }}>
              {data?.yieldNote} 最近分红按除权除息日。无最新成交时价格为最近已知收盘，以灰色显示。
            </p>
          </>
        ) : null}
        {pages > 1 ? (
          <div className="pager">
            <button
              type="button"
              className="btn"
              disabled={page <= 1}
              onClick={() => setQuery({ page: page - 1 })}
            >
              上一页
            </button>
            <span className="mono subdued">
              {page} / {pages}
            </span>
            <button
              type="button"
              className="btn"
              disabled={page >= pages}
              onClick={() => setQuery({ page: page + 1 })}
            >
              下一页
            </button>
          </div>
        ) : null}
      </section>
    </DividendShell>
  );
}

function PriceCell({ item }: { item: StockListItem }) {
  return (
    <td className={item.quoteFresh ? "num mono" : "num mono quote-stale"}>
      {formatPrice(item.lastClose)}
      {!item.quoteFresh && item.lastClose != null ? <span className="subdued"> 已知</span> : null}
    </td>
  );
}

function SortableHead({
  label,
  sort,
  active,
  align,
  onSort,
}: {
  label: string;
  sort: StockSort;
  active: StockSort;
  align?: "right";
  onSort: (sort: StockSort) => void;
}) {
  return (
    <th
      className={align === "right" ? "num" : undefined}
      aria-sort={active === sort ? "descending" : "none"}
    >
      <button type="button" className="linkish" onClick={() => onSort(sort)}>
        {label}
      </button>
    </th>
  );
}
