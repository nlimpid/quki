import { IMAGE_PROCESS_DISCLOSURE, localImportPlan } from "@quki/analytics";
import { useEffect, useState } from "react";

import {
  fetchAccountHoldings,
  writeAccountHoldings,
  type AccountHoldingsResponse,
} from "../lib/holdingsAccount.js";
import type { AuthPhase } from "../lib/authState.js";
import { portfolioSubtitle } from "../lib/authState.js";
import { readLocalHoldingsForImport } from "../lib/holdingsStore.js";
import { formatShares } from "../lib/stockFormat.js";

type PlanRow = { code: string; shares: number; previousShares: number | null };

export function AccountHoldings({ phase }: { phase: AuthPhase }) {
  const csrfToken = "csrfToken" in phase ? phase.csrfToken : "";
  const locked = phase.kind === "logoutPending" || csrfToken.length === 0;
  const [loaded, setLoaded] = useState<AccountHoldingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [shares, setShares] = useState("");
  const [plan, setPlan] = useState<PlanRow[] | null>(null);

  useEffect(() => {
    const cancelled = { current: false };
    fetchAccountHoldings()
      .then((body) => {
        if (!cancelled.current) setLoaded(body);
      })
      .catch(() => {
        if (!cancelled.current) setError("账户持仓暂不可用。本机持仓未改动。");
      });
    return () => {
      cancelled.current = true;
    };
  }, []);

  const items = loaded?.items ?? [];

  async function save(next: { code: string; shares: number }[], confirmEmpty = false) {
    setError(null);
    try {
      const body = await writeAccountHoldings({
        path: "/api/holdings",
        csrfToken,
        idempotencyKey: crypto.randomUUID(),
        items: next,
        confirmEmpty,
      });
      setLoaded(body);
    } catch {
      setError("没有写入账户。本机持仓未改动。");
    }
  }

  function onImportLocal() {
    const local = readLocalHoldingsForImport();
    setPlan(localImportPlan(local.items, items));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">账户持仓</h1>
          <p className="page-sub">{portfolioSubtitle(phase)}</p>
        </div>
      </div>
      {error ? <p className="yield-note">{error}</p> : null}
      {loaded?.reference ? (
        <p className="yield-note">
          {loaded.reference.label}
          {loaded.reference.totalCashCny == null
            ? " 暂无合计。"
            : ` 参考合计 ${loaded.reference.totalCashCny} 元。`}
          {loaded.reference.partial ? " 合计不完整。" : ""}
        </p>
      ) : null}
      {items.length === 0 ? <p className="page-sub">账户里还没有股数。</p> : null}
      <div className="hold-grid">
        {items.map((item) => (
          <article key={item.code} className="div-card hold-card">
            <div className="mono">{item.code}</div>
            <div>持股 {formatShares(item.shares)} 股</div>
            <button
              type="button"
              className="text-btn"
              disabled={locked}
              onClick={() => {
                const next = items
                  .filter((row) => row.code !== item.code)
                  .map((row) => ({ code: row.code, shares: row.shares }));
                void save(next, next.length === 0);
              }}
            >
              从账户移除
            </button>
          </article>
        ))}
      </div>
      <form
        className="div-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (!/^\d{6}$/.test(code) || !/^[1-9]\d*$/.test(shares)) {
            setError("代码需为 6 位数字，股数需为整数。");
            return;
          }
          const next = [
            ...items
              .filter((row) => row.code !== code)
              .map((row) => ({ code: row.code, shares: row.shares })),
            { code, shares: Number(shares) },
          ];
          void save(next);
        }}
      >
        <label>
          股票代码
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
          />
        </label>
        <label>
          总股数
          <input
            value={shares}
            onChange={(event) => setShares(event.target.value)}
            inputMode="numeric"
          />
        </label>
        <button type="submit" className="btn primary" disabled={locked}>
          保存到账户
        </button>
      </form>
      <section className="div-card">
        <h2>导入本机持仓</h2>
        <p className="page-sub">
          这不会自动发生。确认后按本机股数设置账户中的相同代码，不会把两边相加，也不会清除本机记录。
        </p>
        <button type="button" className="btn" disabled={locked} onClick={onImportLocal}>
          查看本机持仓
        </button>
        {plan ? (
          <>
            {plan.length === 0 ? <p>本机没有可导入的持仓。</p> : null}
            {plan.map((row) => (
              <p key={row.code} className="mono">
                {row.code} 设为 {row.shares} 股
                {row.previousShares == null ? "" : `（账户当前 ${row.previousShares}，不会相加）`}
              </p>
            ))}
            <button
              type="button"
              className="btn primary"
              disabled={locked || plan.length === 0}
              onClick={() => {
                void writeAccountHoldings({
                  path: "/api/holdings/import",
                  csrfToken,
                  idempotencyKey: crypto.randomUUID(),
                  items: plan.map((row) => ({ code: row.code, shares: row.shares })),
                })
                  .then((body) => {
                    setLoaded(body);
                    setPlan(null);
                  })
                  .catch(() => setError("没有导入。本机持仓未改动。"));
              }}
            >
              确认导入到账户
            </button>
          </>
        ) : null}
      </section>
      <section className="div-card">
        <h2>截图识图</h2>
        <p>{loaded?.imageDisclosure ?? IMAGE_PROCESS_DISCLOSURE}</p>
        <p className="page-sub">识图服务尚未选择，图片不会上传。</p>
        <label>
          <input type="checkbox" disabled /> 我同意在服务配置后把截图交给第三方处理
        </label>
        <input type="file" accept="image/png,image/jpeg" disabled aria-label="选择截图" />
      </section>
    </>
  );
}
