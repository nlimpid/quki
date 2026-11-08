import { portfolioDividendSummary, type HoldingsState } from "@quki/analytics";
import type { StockListItem } from "@quki/types";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { deleteHolding, readHoldings, saveHolding } from "../lib/holdingsStore.js";
import { fetchStockBatch, fetchStockList } from "../lib/stockApi.js";
import { formatCny, formatShares, formatYield, weightLabel } from "../lib/stockFormat.js";
import { DividendShell } from "./DividendShell.js";

type Card = {
  code: string;
  shares: number;
  name: string;
  exchange: string;
  price: number | null;
  quoteFresh: boolean;
  yieldPct: number | null;
  ttmCashPerShare: number | null;
  annual: number | null;
  missing: boolean;
};

export function PortfolioPage() {
  const [loaded] = useState(readHoldings);
  const [holdings, setHoldings] = useState<HoldingsState>(loaded.state);
  const storageError = loaded.error;
  const codeKey = holdings.items.map((item) => item.code).join(",");
  const [quotes, setQuotes] = useState<StockListItem[]>([]);
  const [sample, setSample] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [seenKey, setSeenKey] = useState(codeKey);
  if (seenKey !== codeKey) {
    setSeenKey(codeKey);
    setQuoteError(null);
  }
  const loading = codeKey.length > 0 && loadedKey !== codeKey && quoteError === null;
  const shownQuotes = codeKey ? quotes : [];
  const [drawer, setDrawer] = useState<{ code: string; shares: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!codeKey) return;
    const cancelled = { current: false };
    const key = codeKey;
    fetchStockBatch(key.split(","))
      .then((body) => {
        if (cancelled.current) return;
        setQuotes(body.items);
        setSample(body.isSample);
        setLoadedKey(key);
      })
      .catch((reason: unknown) => {
        if (cancelled.current) return;
        setQuoteError(reason instanceof Error ? reason.message : "行情加载失败");
        setLoadedKey(key);
      });
    return () => {
      cancelled.current = true;
    };
  }, [codeKey]);

  const quotesByCode = new Map(shownQuotes.map((item) => [item.code, item]));
  const cards: Card[] = holdings.items.map((holding) => {
    const quote = quotesByCode.get(holding.code);
    const ttm = quote?.ttmCashPerShare ?? null;
    return {
      code: holding.code,
      shares: holding.shares,
      name: quote?.name ?? holding.code,
      exchange: quote?.exchange ?? "",
      price: quote?.lastClose ?? null,
      quoteFresh: quote?.quoteFresh ?? false,
      yieldPct: quote?.trailingYieldPct ?? null,
      ttmCashPerShare: ttm,
      annual: ttm == null ? null : holding.shares * ttm,
      missing: !quote,
    };
  });

  const summary = portfolioDividendSummary(
    cards.map((card) => ({
      shares: card.shares,
      price: card.price,
      ttmCashPerShare: card.ttmCashPerShare,
      yieldPct: card.yieldPct,
    })),
  );

  return (
    <DividendShell activeNav="portfolio">
      <div className="page-head">
        <div>
          <h1 className="page-title">
            我的持仓
            {sample ? <span className="sample-pill">示例数据</span> : null}
          </h1>
          <p className="page-sub">本地保存 · 未登录 · 清除站点数据会丢失 · 登录同步即将推出</p>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => setDrawer({ code: "", shares: "" })}
        >
          ＋ 添加股票
        </button>
      </div>
      {storageError ? <p className="yield-note">{storageError}</p> : null}
      {quoteError ? <p className="yield-note">{quoteError}</p> : null}
      {holdings.items.length === 0 ? (
        <section className="div-card hero">
          <h2 style={{ margin: "0 0 8px" }}>尚未添加持仓</h2>
          <p className="page-sub">添加股票后，这里显示平均股息率和预估全年分红。</p>
          <button
            type="button"
            className="btn primary"
            onClick={() => setDrawer({ code: "", shares: "" })}
          >
            添加股票
          </button>
        </section>
      ) : (
        <>
          <div className="summary-strip">
            <section className="div-card hero">
              <label>持仓只数</label>
              <div className="v mono">{summary.count}</div>
            </section>
            <section className="div-card hero">
              <label>组合平均股息率</label>
              <div className="v mono">{formatYield(summary.avgYieldPct)}</div>
              <p className="yield-note">{weightLabel(summary.weight)} · 税前</p>
            </section>
            <section className="div-card hero">
              <label>预估全年分红</label>
              <div className="v mono">{formatCny(summary.annualCashCny)}</div>
              <p className="yield-note">税前估算 · 非承诺</p>
            </section>
          </div>
          {loading ? <div className="skeleton skel-row" /> : null}
          <div className="hold-grid">
            {cards.map((card) => (
              <article key={card.code} className="div-card hold-card">
                <div className="hold-top">
                  <div>
                    <Link to={`/stock/${card.code}`} style={{ fontWeight: 600, fontSize: 16 }}>
                      {card.name}
                    </Link>
                    <div className="mono subdued">
                      {card.exchange ? `${card.code}.${card.exchange}` : card.code}
                    </div>
                  </div>
                  <div>
                    <button
                      type="button"
                      className="icon-text"
                      aria-label="编辑"
                      onClick={() => setDrawer({ code: card.code, shares: String(card.shares) })}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="icon-text"
                      aria-label={pendingDelete === card.code ? "确认删除" : "删除"}
                      onClick={() => {
                        if (pendingDelete !== card.code) {
                          setPendingDelete(card.code);
                          return;
                        }
                        setHoldings(deleteHolding(card.code));
                        setPendingDelete(null);
                      }}
                    >
                      {pendingDelete === card.code ? "确认" : "×"}
                    </button>
                  </div>
                </div>
                <div className="hold-shares">
                  持股 <span className="mono">{formatShares(card.shares)}</span> 股
                </div>
                <div
                  className={
                    card.quoteFresh || card.price == null ? "subdued" : "subdued quote-stale"
                  }
                >
                  最新价{" "}
                  <span className="mono">
                    {card.price == null
                      ? "—"
                      : card.price.toLocaleString("zh-CN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                  </span>
                  {!card.quoteFresh && card.price != null ? " · 最近已知" : ""}
                  {card.missing ? " · 未找到行情" : ""}
                </div>
                <div className="hold-metric" style={{ marginTop: 12 }}>
                  <label>平均股息率</label>
                  <div className="v mono">{formatYield(card.yieldPct)}</div>
                </div>
                <div className="hold-metric" style={{ marginTop: 10 }}>
                  <label>预估全年分红</label>
                  <div className="v mono">{formatCny(card.annual)}</div>
                </div>
              </article>
            ))}
          </div>
          <p className="yield-note">
            平均股息率与列表「近12月股息率」同一口径：近12个自然月税前现金（每股，已按其后送转除权）÷
            最新收盘价。预估全年分红 = 持股数 × 该每股现金。送转不计入分子。
          </p>
        </>
      )}
      {drawer ? (
        <HoldingDrawer
          initialCode={drawer.code}
          initialShares={drawer.shares}
          onClose={() => setDrawer(null)}
          onSave={(code, shares) => {
            setHoldings(saveHolding(code, shares));
            setDrawer(null);
          }}
        />
      ) : null}
    </DividendShell>
  );
}

function HoldingDrawer({
  initialCode,
  initialShares,
  onClose,
  onSave,
}: {
  initialCode: string;
  initialShares: string;
  onClose: () => void;
  onSave: (code: string, shares: number) => void;
}) {
  const locked = /^\d{6}$/.test(initialCode);
  const [q, setQ] = useState(locked ? initialCode : "");
  const [hits, setHits] = useState<StockListItem[]>([]);
  const [code, setCode] = useState(locked ? initialCode : "");
  const [name, setName] = useState("");
  const [shares, setShares] = useState(initialShares);
  const [error, setError] = useState<string | null>(null);

  const query = q.trim();
  useEffect(() => {
    if (locked || query.length === 0) return;
    const handle = window.setTimeout(() => {
      fetchStockList({ q: query, pageSize: 8 })
        .then((body) => setHits(body.items))
        .catch(() => setHits([]));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query, locked]);
  const visibleHits = !locked && query.length > 0 ? hits : [];

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="drawer-back" onClick={onClose}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={locked ? "编辑持仓" : "添加股票"}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 style={{ marginTop: 0 }}>{locked ? "编辑持仓" : "添加股票"}</h2>
        {locked ? (
          <p className="mono">{initialCode}</p>
        ) : (
          <>
            <input
              type="search"
              placeholder="搜索代码 / 名称"
              aria-label="搜索代码 / 名称"
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
            {visibleHits.map((hit) => (
              <button
                key={hit.code}
                type="button"
                className="search-hit"
                onClick={() => {
                  setCode(hit.code);
                  setName(hit.name);
                }}
              >
                <span>{hit.name}</span>
                <span className="mono subdued">{hit.code}</span>
              </button>
            ))}
            {code ? (
              <p>
                已选 {name} <span className="mono">{code}</span>
              </p>
            ) : null}
          </>
        )}
        <label style={{ display: "block", margin: "16px 0 8px" }}>
          股数
          <input
            inputMode="numeric"
            value={shares}
            onChange={(event) => setShares(event.target.value)}
            aria-label="股数"
          />
        </label>
        {error ? <p className="yield-note">{error}</p> : null}
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            const chosen = locked ? initialCode : code;
            try {
              onSave(chosen, Number(shares));
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : "无法保存");
            }
          }}
        >
          保存到本机
        </button>
        <p className="yield-note">数据仅保存在此浏览器，清除站点数据会丢失。登录同步即将推出。</p>
      </div>
    </div>
  );
}
