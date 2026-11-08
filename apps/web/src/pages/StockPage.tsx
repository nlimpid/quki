import type { DividendEventDto, DividendYears, StockDetailResponse } from "@quki/types";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { readHoldings, saveHolding } from "../lib/holdingsStore.js";
import { fetchStock, parseYears } from "../lib/stockApi.js";
import {
  eventBadges,
  formatBeijing,
  formatPer10,
  formatPrice,
  formatYield,
} from "../lib/stockFormat.js";
import { DividendShell } from "./DividendShell.js";

const YEAR_OPTIONS: { id: DividendYears; label: string }[] = [
  { id: "5", label: "5年" },
  { id: "10", label: "10年" },
  { id: "MAX", label: "全部" },
];

export function StockPage() {
  const { code = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const years = parseYears(params.get("years"));
  const valid = /^\d{6}$/.test(code);
  const request = `${code}|${years}`;
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 640px)").matches);
  const viewParam = params.get("view");
  const view =
    viewParam === "timeline" || viewParam === "table" ? viewParam : narrow ? "timeline" : "table";
  const [detail, setDetail] = useState<StockDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [seenRequest, setSeenRequest] = useState(request);
  if (seenRequest !== request) {
    setSeenRequest(request);
    setError(null);
  }
  const loading = valid && loadedKey !== request && error === null;
  const [heldCodes, setHeldCodes] = useState(
    () => new Set(readHoldings().state.items.map((item) => item.code)),
  );
  const held = heldCodes.has(code);
  const [shares, setShares] = useState("100");
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const apply = () => setNarrow(media.matches);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!valid) return;
    const cancelled = { current: false };
    const key = `${code}|${years}`;
    fetchStock(code, years)
      .then((body) => {
        if (cancelled.current) return;
        setDetail(body);
        setLoadedKey(key);
      })
      .catch((reason: unknown) => {
        if (cancelled.current) return;
        setDetail(null);
        setError(reason instanceof Error ? reason.message : "分红数据加载失败");
        setLoadedKey(key);
      });
    return () => {
      cancelled.current = true;
    };
  }, [code, years, valid]);

  function patch(next: { years?: DividendYears; view?: "table" | "timeline" }) {
    const search = new URLSearchParams(params);
    if (next.years) {
      if (next.years === "10") search.delete("years");
      else search.set("years", next.years);
    }
    if (next.view) search.set("view", next.view);
    setParams(search);
  }

  const company = detail?.company;

  return (
    <DividendShell activeNav="stocks">
      <p className="crumb">
        <Link to="/stocks">个股</Link>
        {" / "}
        <span className="mono">{code}</span> {company?.name ?? ""}
      </p>
      {!valid ? (
        <section className="div-card hero">
          <div className="state-block">
            未找到该股票
            <div>
              <Link to="/stocks">返回个股列表</Link>
            </div>
          </div>
        </section>
      ) : null}
      {loading ? (
        <section className="div-card hero">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="skeleton skel-row" />
          ))}
        </section>
      ) : null}
      {!loading && error ? (
        <section className="div-card hero">
          <div className="state-block">
            {error === "未找到该股票" ? "未找到该股票" : "分红数据加载失败"}
            <div>
              <Link to="/stocks">返回个股列表</Link>
            </div>
          </div>
        </section>
      ) : null}
      {!loading && !error && company ? (
        <>
          <section className="div-card hero">
            <div className="hero-top">
              <div>
                <div className="hero-name">
                  {company.name}{" "}
                  {detail?.isSample ? <span className="sample-pill">示例数据</span> : null}
                </div>
                <div className="subdued">
                  <span className="mono">
                    {company.code}.{company.exchange}
                  </span>{" "}
                  · 无 K 线 · 专注分红记录
                </div>
              </div>
              {held ? (
                <Link className="btn" to="/portfolio">
                  已在持仓
                </Link>
              ) : (
                <form
                  className="div-toolbar"
                  onSubmit={(event) => {
                    event.preventDefault();
                    try {
                      const next = saveHolding(company.code, Number(shares));
                      setHeldCodes(new Set(next.items.map((item) => item.code)));
                      setSaved(null);
                    } catch (reason) {
                      setSaved(reason instanceof Error ? reason.message : "无法保存");
                    }
                  }}
                >
                  <input
                    aria-label="持股数量"
                    inputMode="numeric"
                    value={shares}
                    onChange={(event) => setShares(event.target.value)}
                    style={{
                      width: 96,
                      height: 36,
                      borderRadius: 8,
                      border: "1px solid var(--qk-border)",
                      padding: "0 8px",
                    }}
                  />
                  <button type="submit" className="btn primary">
                    加入持仓
                  </button>
                </form>
              )}
            </div>
            {saved ? <p className="yield-note">{saved}</p> : null}
            <div className="hero-grid">
              <div className="metric">
                <label>近12月股息率</label>
                <div className="v mono">{formatYield(company.trailingYieldPct)}</div>
                <div className="subdued">税前 · 与持仓同一口径</div>
              </div>
              <div className="metric">
                <label>最近每10股派息</label>
                <div className="v mono">{formatPer10(company.lastCashPer10)}</div>
                <div className="subdued">元 · 税前</div>
              </div>
              <div className="metric">
                <label>最近除权日</label>
                <div className="v mono" style={{ fontSize: 18 }}>
                  {company.lastCashDivDate ?? "—"}
                </div>
                <div className="subdued">派息日未收录</div>
              </div>
              <div className="metric">
                <label>最新价</label>
                <div className={company.quoteFresh ? "v mono" : "v mono quote-stale"}>
                  {formatPrice(company.lastClose)}
                </div>
                <div className="subdued">
                  {company.quoteFresh ? "纯文本 · 不展示蜡烛图" : "最近已知收盘 · 无最新成交"}
                </div>
              </div>
            </div>
            <p className="yield-note">
              {detail?.yieldNote} 数据截至{" "}
              <span className="mono">{formatBeijing(detail?.asOf)}</span> 北京时间
              {detail?.yieldAsOf ? (
                <>
                  {" "}
                  · 窗口截至 <span className="mono">{detail.yieldAsOf}</span>
                </>
              ) : null}
            </p>
          </section>
          <section className="div-card history" style={{ marginTop: 16 }}>
            <div className="history-bar">
              <h2 style={{ margin: 0, fontSize: 16 }}>分红记录</h2>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div className="seg" role="tablist" aria-label="年限">
                  {YEAR_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={years === option.id ? "active" : undefined}
                      onClick={() => patch({ years: option.id })}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="seg" role="tablist" aria-label="视图">
                  <button
                    type="button"
                    className={view === "table" ? "active" : undefined}
                    onClick={() => patch({ view: "table" })}
                  >
                    表格
                  </button>
                  <button
                    type="button"
                    className={view === "timeline" ? "active" : undefined}
                    onClick={() => patch({ view: "timeline" })}
                  >
                    时间线
                  </button>
                </div>
              </div>
            </div>
            {detail && detail.events.length === 0 ? (
              <div className="state-block">暂无分红 / 送转记录</div>
            ) : null}
            {view === "table" && detail && detail.events.length > 0 ? (
              <div className="div-table-wrap" style={{ padding: 0 }}>
                <DividendTable events={detail.events} />
              </div>
            ) : null}
            {view === "timeline" && detail && detail.events.length > 0 ? (
              <DividendTimeline events={detail.events} />
            ) : null}
            <p className="yield-note">
              单位：派息为元（税前）· 送/转为股（每 10 股）·
              表内为公告原值。估算股息率时，历史每股现金已按其后送转除权。派息日此数据源未提供。送转以外公司行为本阶段不收录。
            </p>
          </section>
        </>
      ) : null}
    </DividendShell>
  );
}

function DividendTable({ events }: { events: DividendEventDto[] }) {
  return (
    <table className="div-table">
      <thead>
        <tr>
          <th>除权日</th>
          <th>类型</th>
          <th className="num">每10股派息</th>
          <th className="num">送</th>
          <th className="num">转</th>
          <th className="num">登记日</th>
          <th className="num">派息日</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <tr key={event.id}>
            <td className="mono">{event.exDate ?? "—"}</td>
            <td>
              {eventBadges(
                event.eventType,
                event.bonusPer10,
                event.transferPer10,
                event.cashPer10,
              ).map((badge) => (
                <span key={badge.kind} className={`badge ${badge.kind}`}>
                  {badge.label}
                </span>
              ))}
            </td>
            <td className="num mono">{formatPer10(event.cashPer10)}</td>
            <td className="num mono">{formatPer10(event.bonusPer10)}</td>
            <td className="num mono">{formatPer10(event.transferPer10)}</td>
            <td className="num mono subdued">{event.recordDate ?? "—"}</td>
            <td className="num mono subdued">{event.payDate ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DividendTimeline({ events }: { events: DividendEventDto[] }) {
  return (
    <div className="timeline">
      {events.map((event) => (
        <article key={event.id}>
          <div className="mono">{event.exDate}</div>
          <div>
            {eventBadges(
              event.eventType,
              event.bonusPer10,
              event.transferPer10,
              event.cashPer10,
            ).map((badge) => (
              <span key={badge.kind} className={`badge ${badge.kind}`}>
                {badge.label}
              </span>
            ))}
          </div>
          <div className="subdued">{event.profile ?? "—"}</div>
        </article>
      ))}
    </div>
  );
}
