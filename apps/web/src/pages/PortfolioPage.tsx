import { portfolioDividendSummary, type HoldingsState } from "@quki/analytics";
import { Button, Drawer, Input, Label, SearchField } from "@heroui/react";
import type { StockListItem } from "@quki/types";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { useAuth } from "../lib/auth.js";
import { usePageTitle } from "../lib/pageTitle.js";
import { ACCOUNT_SAVE_COPY, ACCOUNT_SAVE_LABEL, portfolioSubtitle } from "../lib/authState.js";
import { HoldingBoard } from "../lib/holdingBoard.js";
import { LocalImportPanel } from "../lib/LocalImportPanel.js";
import { useAccountBook } from "../lib/accountBook.js";
import { showAccountBook } from "../lib/accountHoldings.js";
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
  const [drawerEpoch, setDrawerEpoch] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const { phase, retry, accessToken, sessionKey, confirmedSessionKey } = useAuth();
  const signedIn = showAccountBook({
    phaseKind: phase.kind,
    sessionKey,
    confirmedSessionKey,
  });
  const account = useAccountBook({ sessionKey, signedIn, accessToken });
  if (drawer && drawerEpoch !== account.epoch) {
    setDrawer(null);
    setDrawerEpoch(null);
    setPendingDelete(null);
  }
  function openDrawer(next: { code: string; shares: string }, source?: Element | null) {
    const opener = source instanceof HTMLElement ? source.closest("button") : null;
    restoreFocus.current =
      opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setDrawerEpoch(account.epoch);
    setDrawer(next);
  }
  function closeDrawer() {
    const target = restoreFocus.current;
    setDrawer(null);
    setDrawerEpoch(null);
    window.setTimeout(() => target?.focus(), 0);
  }
  const { notice, request } = useHoldingIntent();
  const [params, setParams] = useSearchParams();
  usePageTitle("我的持仓 · quki");
  const addIntent = phase.kind === "authenticated" && params.get("add") === "1";
  const editIntent = phase.kind === "authenticated" ? params.get("edit") : null;
  const intent = addIntent ? "add" : editIntent && /^\d{6}$/.test(editIntent) ? editIntent : "";
  const [openedIntent, setOpenedIntent] = useState("");
  if (intent && intent !== openedIntent) {
    if (signedIn && intent !== "add" && account.items == null) {
      // Wait until the account list is loaded so the edit uses that row's version.
    } else {
      setOpenedIntent(intent);
      if (intent === "add") {
        setDrawerEpoch(account.epoch);
        setDrawer({ code: "", shares: "" });
      } else if (signedIn) {
        const item = account.items?.find((row) => row.code === intent);
        if (item) {
          setDrawerEpoch(account.epoch);
          setDrawer({ code: item.code, shares: String(item.shares) });
        }
      } else {
        const item = holdings.items.find((holding) => holding.code === intent);
        setDrawerEpoch(account.epoch);
        setDrawer({ code: intent, shares: item ? String(item.shares) : "" });
      }
      const next = new URLSearchParams(params);
      next.delete("add");
      next.delete("edit");
      setParams(next, { replace: true });
    }
  }

  useEffect(() => {
    if (phase.kind !== "guest" || !codeKey) return;
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
  }, [codeKey, phase.kind]);

  const quotesByCode = new Map(shownQuotes.map((item) => [item.code, item]));
  const cards: Card[] = (signedIn ? [] : holdings.items).map((holding) => {
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
      {account.error ? (
        <p id="account-error" className="page-sub">
          {account.error}
        </p>
      ) : null}
      {signedIn ? (
        <LocalImportPanel
          rows={holdings.items}
          accountRows={account.items}
          epoch={account.epoch}
          busy={account.busy}
          readFailed={account.error != null}
          onImport={async (writes) => {
            const ticket = account.epoch;
            for (const row of writes) {
              const result = await account.save({ ticket, ...row });
              if (result !== "written") return;
            }
          }}
        />
      ) : null}
      {quoteError ? <p className="yield-note">{quoteError}</p> : null}
      {signedIn && account.items == null && !account.error ? (
        <p className="page-sub">正在读取账户持仓…</p>
      ) : null}
      {signedIn && account.items && account.items.length === 0 ? (
        <section className="div-card hero" aria-label="账户持仓">
          <h2 style={{ margin: "0 0 8px" }}>尚未添加持仓</h2>
          <p className="page-sub">添加股票后，持仓会列在这里。</p>
        </section>
      ) : null}
      {signedIn && account.items && account.items.length > 0 ? (
        <HoldingBoard
          rows={account.items}
          pendingDelete={pendingDelete}
          deleteId={(code) => `delete-${code}`}
          onEdit={(row, source) => {
            if (!request(`/portfolio?edit=${row.code}`)) return;
            openDrawer({ code: row.code, shares: String(row.shares) }, source);
          }}
          onDelete={(code) => {
            if (!request("/portfolio")) return;
            if (pendingDelete !== code) {
              setPendingDelete(code);
              return;
            }
            setPendingDelete(null);
            const version = account.items?.find((item) => item.code === code)?.version;
            if (!version) return;
            void account.removeRow(account.epoch, code, version);
          }}
        />
      ) : null}
      {signedIn && holdings.items.length === 0 ? (
        <p className="yield-note">此浏览器里没有旧持仓。</p>
      ) : null}
      {signedIn && holdings.items.length > 0 ? (
        <>
          <h2 className="page-title" style={{ fontSize: 18 }}>
            此浏览器里的旧持仓
          </h2>
          <ul id="local-holdings">
            {holdings.items.map((item) => (
              <li key={item.code}>
                <span className="mono">{item.code}</span> · {item.shares} 股
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {!signedIn && holdings.items.length === 0 ? (
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
      ) : null}
      {!signedIn && holdings.items.length > 0 ? (
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
      ) : null}
      {drawer ? (
        <HoldingDrawer
          initialCode={drawer.code}
          initialShares={drawer.shares}
          saveError={account.error}
          onClose={closeDrawer}
          onSave={(code, shares) => {
            if (!request("/portfolio")) return;
            if (!signedIn) return;
            const ticket = drawerEpoch ?? account.epoch;
            const expectedVersion =
              account.items?.find((item) => item.code === code)?.version ?? null;
            void account
              .save({ ticket, code, shares, expectedVersion })
              .then((result) => {
                if (result === "written") closeDrawer();
              })
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
  saveError,
  onClose,
  onSave,
}: {
  initialCode: string;
  initialShares: string;
  saveError: string | null;
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
              {saveError ? <p className="yield-note">{saveError}</p> : null}
              {error ? <p className="yield-note">{error}</p> : null}
              <p className="yield-note">{ACCOUNT_SAVE_COPY}</p>
            </Drawer.Body>
            <Drawer.Footer>
              <Button variant="secondary" onPress={onClose}>
                取消
              </Button>
              <Button variant="primary" onPress={save}>
                {ACCOUNT_SAVE_LABEL}
              </Button>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
