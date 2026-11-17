import { portfolioDividendSummary, type HoldingsState } from "@quki/analytics";
import { Button, Drawer, Input, Label, SearchField } from "@heroui/react";
import type { StockListItem } from "@quki/types";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { useAuth } from "../lib/auth.js";
import { usePageTitle } from "../lib/pageTitle.js";
import { portfolioSubtitle } from "../lib/authState.js";
import {
  readAccountHoldings,
  writeAccountHoldings,
  type AccountHolding,
} from "../lib/accountHoldings.js";
import { useHoldingIntent } from "../lib/holdingIntent.js";
import { readHoldings } from "../lib/holdingsStore.js";
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
  const [holdings] = useState<HoldingsState>(loaded.state);
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
  const restoreFocus = useRef<HTMLElement | null>(null);
  function openDrawer(next: { code: string; shares: string }, source?: Element | null) {
    const opener = source instanceof HTMLElement ? source.closest("button") : null;
    restoreFocus.current =
      opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setDrawer(next);
  }
  function closeDrawer() {
    const target = restoreFocus.current;
    setDrawer(null);
    window.setTimeout(() => target?.focus(), 0);
  }
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [accountItems, setAccountItems] = useState<AccountHolding[] | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const { phase, retry } = useAuth();
  const { notice, request } = useHoldingIntent();
  const [params, setParams] = useSearchParams();
  usePageTitle("我的持仓 · quki");
  const addIntent = phase.kind === "authenticated" && params.get("add") === "1";
  const editIntent = phase.kind === "authenticated" ? params.get("edit") : null;
  const intent = addIntent ? "add" : editIntent && /^\d{6}$/.test(editIntent) ? editIntent : "";
  const [openedIntent, setOpenedIntent] = useState("");
  if (intent && intent !== openedIntent) {
    setOpenedIntent(intent);
    if (intent === "add") setDrawer({ code: "", shares: "" });
    else {
      const item = holdings.items.find((holding) => holding.code === intent);
      setDrawer({ code: intent, shares: item ? String(item.shares) : "" });
    }
    const next = new URLSearchParams(params);
    next.delete("add");
    next.delete("edit");
    setParams(next, { replace: true });
  }

  useEffect(() => {
    if (phase.kind !== "authenticated") return;
    let cancel = false;
    readAccountHoldings()
      .then((items) => {
        if (cancel) return;
        setAccountItems(items);
      })
      .catch((reason: unknown) => {
        if (cancel) return;
        setAccountError(reason instanceof Error ? reason.message : "账户持仓没有读取成功");
      });
    return () => {
      cancel = true;
    };
  }, [phase.kind]);

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
          <p className="page-sub">{portfolioSubtitle(phase)}</p>
        </div>
        <Button
          variant="primary"
          onPress={(event) => {
            if (!request("/portfolio?add=1")) return;
            openDrawer({ code: "", shares: "" }, event.target);
          }}
        >
          ＋ 添加股票
        </Button>
      </div>
      {storageError ? <p className="yield-note">{storageError}</p> : null}
      {notice ? (
        <p className="yield-note">
          {notice}{" "}
          {notice.includes("重试") || notice.includes("无法确认") ? (
            <button type="button" className="text-btn" onClick={() => retry()}>
              重试
            </button>
          ) : null}
        </p>
      ) : null}
      {phase.kind === "authenticated" ? (
        <section className="div-card" aria-label="账户持仓">
          <h2 style={{ margin: "0 0 8px" }}>账户持仓</h2>
          {accountError ? <p className="page-sub">{accountError}</p> : null}
          {!accountError && accountItems == null ? (
            <p className="page-sub">正在读取账户持仓…</p>
          ) : null}
          {!accountError && accountItems?.length === 0 ? (
            <p className="page-sub">账户里还没有持仓。</p>
          ) : null}
          {!accountError && accountItems && accountItems.length > 0 ? (
            <ul>
              {accountItems.map((item) => (
                <li key={item.code}>
                  <span className="mono">{item.code}</span> · {formatShares(item.shares)} 股
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {quoteError ? <p className="yield-note">{quoteError}</p> : null}
      {holdings.items.length > 0 && phase.kind === "authenticated" ? (
        <h2 className="page-title" style={{ fontSize: 18 }}>
          此浏览器里的旧持仓
        </h2>
      ) : null}
      {holdings.items.length === 0 ? (
        phase.kind === "authenticated" ? (
          <p className="yield-note">此浏览器里没有旧持仓。</p>
        ) : (
          <section className="div-card hero">
            <h2 style={{ margin: "0 0 8px" }}>尚未添加持仓</h2>
            <p className="page-sub">添加股票后，这里显示平均股息率和预估全年分红。</p>
            <Button
              variant="primary"
              onPress={(event) => {
                if (!request("/portfolio?add=1")) return;
                openDrawer({ code: "", shares: "" }, event.target);
              }}
            >
              添加股票
            </Button>
          </section>
        )
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
                  {phase.kind === "authenticated" ? null : (
                    <div>
                      <button
                        type="button"
                        className="icon-text"
                        aria-label="编辑"
                        onClick={(event) => {
                          if (!request(`/portfolio?edit=${card.code}`)) return;
                          openDrawer(
                            { code: card.code, shares: String(card.shares) },
                            event.currentTarget,
                          );
                        }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="icon-text"
                        aria-label={pendingDelete === card.code ? "确认删除" : "删除"}
                        onClick={() => {
                          if (!request("/portfolio")) return;
                          if (pendingDelete !== card.code) {
                            setPendingDelete(card.code);
                            return;
                          }
                          setPendingDelete(null);
                        }}
                      >
                        {pendingDelete === card.code ? "确认" : "×"}
                      </button>
                    </div>
                  )}
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
          onClose={closeDrawer}
          onSave={(code, shares) => {
            if (!request("/portfolio")) return;
            if (phase.kind !== "authenticated") return;
            void writeAccountHoldings(
              { code, shares, updatedAt: new Date().toISOString(), expectedVersion: null },
              phase.csrfToken,
            )
              .then(() => closeDrawer())
              .catch((reason: unknown) => {
                setQuoteError(reason instanceof Error ? reason.message : "账户持仓没有保存");
              });
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

  function save() {
    const chosen = locked ? initialCode : code;
    try {
      onSave(chosen, Number(shares));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法保存");
    }
  }

  return (
    <Drawer
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Drawer.Backdrop>
        <Drawer.Content placement="right">
          <Drawer.Dialog aria-label={locked ? "编辑持仓" : "添加股票"}>
            <Drawer.Header>
              <Drawer.Heading>{locked ? "编辑持仓" : "添加股票"}</Drawer.Heading>
              <Drawer.CloseTrigger />
            </Drawer.Header>
            <Drawer.Body>
              {locked ? (
                <p className="mono">{initialCode}</p>
              ) : (
                <>
                  <SearchField aria-label="搜索代码 / 名称" value={q} onChange={setQ}>
                    <SearchField.Group>
                      <SearchField.SearchIcon />
                      <SearchField.Input placeholder="搜索代码 / 名称" autoFocus />
                      <SearchField.ClearButton />
                    </SearchField.Group>
                  </SearchField>
                  {visibleHits.map((hit) => (
                    <Button
                      key={hit.code}
                      variant="ghost"
                      fullWidth
                      onPress={() => {
                        setCode(hit.code);
                        setName(hit.name);
                      }}
                    >
                      <span>{hit.name}</span>
                      <span className="mono subdued">{hit.code}</span>
                    </Button>
                  ))}
                  {code ? (
                    <p>
                      已选 {name} <span className="mono">{code}</span>
                    </p>
                  ) : null}
                </>
              )}
              <Label style={{ display: "block", margin: "16px 0 8px" }}>
                股数
                <Input
                  fullWidth
                  inputMode="numeric"
                  value={shares}
                  onChange={(event) => setShares(event.target.value)}
                  aria-label="股数"
                />
              </Label>
              {error ? <p className="yield-note">{error}</p> : null}
              <p className="yield-note">
                数据仅保存在此浏览器，清除站点数据会丢失。登录不会上传或同步持仓。
              </p>
            </Drawer.Body>
            <Drawer.Footer>
              <Button variant="secondary" onPress={onClose}>
                取消
              </Button>
              <Button variant="primary" onPress={save}>
                保存到本机
              </Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
