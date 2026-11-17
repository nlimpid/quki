import { Button, SearchField, Table } from "@heroui/react";
import { FilterGroup } from "../components/FilterGroup.js";
import { usePageTitle } from "../lib/pageTitle.js";
import type { StockListResponse, StockMarketFilter, StockSort } from "@quki/types";
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
  usePageTitle("个股股息 · quki");

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
        <SearchField aria-label="搜索代码 / 名称" value={draft} onChange={setDraft}>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="搜索代码 / 名称" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <FilterGroup
          label="市场"
          value={market}
          options={MARKETS.map((item) => ({ id: item.id, label: item.label }))}
          onChange={(next) => setQuery({ market: next })}
        />
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
              <Button variant="secondary" onPress={() => setAttempt((value) => value + 1)}>
                重试
              </Button>
            </div>
          </div>
        ) : null}
        {!loading && !error && items.length === 0 ? (
          <div className="state-block">
            没有匹配的股票
            {q ? (
              <div>
                <Button
                  variant="secondary"
                  onPress={() => {
                    setDraft("");
                    const next = new URLSearchParams(params);
                    next.delete("q");
                    next.delete("page");
                    setParams(next);
                  }}
                >
                  清空搜索
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {!loading && !error && items.length > 0 ? (
          <>
            <div className="div-table-wrap list-table">
              <Table>
                <Table.ScrollContainer>
                  <Table.Content aria-label="股票列表">
                    <Table.Header>
                      <Table.Column isRowHeader>
                        <SortButton
                          label="代码"
                          sort="code"
                          active={sort}
                          onSort={(next) => setQuery({ sort: next })}
                        />
                      </Table.Column>
                      <Table.Column>名称</Table.Column>
                      <Table.Column>最新价</Table.Column>
                      <Table.Column>
                        <SortButton
                          label="近12月股息率"
                          sort="yield"
                          active={sort}
                          onSort={(next) => setQuery({ sort: next })}
                        />
                      </Table.Column>
                      <Table.Column>
                        <SortButton
                          label="最近除权日"
                          sort="lastDivDate"
                          active={sort}
                          onSort={(next) => setQuery({ sort: next })}
                        />
                      </Table.Column>
                      <Table.Column>每10股派息</Table.Column>
                    </Table.Header>
                    <Table.Body>
                      {items.map((item) => (
                        <Table.Row key={item.code} id={item.code}>
                          <Table.Cell className="mono">
                            <Link to={`/stock/${item.code}`}>{item.code}</Link>
                          </Table.Cell>
                          <Table.Cell>
                            <Link to={`/stock/${item.code}`}>{item.name}</Link>{" "}
                            <span className="subdued">{item.exchange}</span>
                          </Table.Cell>
                          <Table.Cell
                            className={item.quoteFresh ? "num mono" : "num mono quote-stale"}
                          >
                            {formatPrice(item.lastClose)}
                            {!item.quoteFresh && item.lastClose != null ? (
                              <span className="subdued"> 已知</span>
                            ) : null}
                          </Table.Cell>
                          <Table.Cell className="num mono">
                            {formatYield(item.trailingYieldPct)}
                          </Table.Cell>
                          <Table.Cell className="num mono subdued">
                            {item.lastCashDivDate ?? "—"}
                          </Table.Cell>
                          <Table.Cell className="num mono">
                            {formatPer10(item.lastCashPer10)}
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Content>
                </Table.ScrollContainer>
              </Table>
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
            <Button
              variant="secondary"
              isDisabled={page <= 1}
              onPress={() => setQuery({ page: page - 1 })}
            >
              上一页
            </Button>
            <span className="mono subdued">
              {page} / {pages}
            </span>
            <Button
              variant="secondary"
              isDisabled={page >= pages}
              onPress={() => setQuery({ page: page + 1 })}
            >
              下一页
            </Button>
          </div>
        ) : null}
      </section>
    </DividendShell>
  );
}

function SortButton({
  label,
  sort,
  active,
  onSort,
}: {
  label: string;
  sort: StockSort;
  active: StockSort;
  onSort: (sort: StockSort) => void;
}) {
  return (
    <button
      type="button"
      className="linkish"
      aria-sort={active === sort ? "descending" : "none"}
      onClick={() => onSort(sort)}
    >
      {label}
    </button>
  );
}
