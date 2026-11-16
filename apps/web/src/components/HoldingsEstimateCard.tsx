import { dividendReferenceNote, type DividendReference } from "@quki/analytics";
import { useEffect, useState } from "react";

import { fetchAccountHoldings, HoldingsRequestError } from "../lib/holdingsAccount.js";
import { usesAccountHoldings } from "../lib/authState.js";
import { useAuth } from "../lib/auth.js";

export function HoldingsEstimateCard() {
  const { phase } = useAuth();
  const visible = usesAccountHoldings(phase);
  const [reference, setReference] = useState<DividendReference | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    const cancelled = { current: false };
    fetchAccountHoldings()
      .then((body) => {
        if (!cancelled.current) setReference(body.reference);
      })
      .catch((reason: unknown) => {
        if (cancelled.current) return;
        if (reason instanceof HoldingsRequestError && reason.status === 401) return;
        setError("账户持仓暂不可用。本机持仓未改动。");
      });
    return () => {
      cancelled.current = true;
    };
  }, [visible]);

  if (!visible) return null;
  return (
    <section className="card estimate-card">
      <div className="pos-kicker">持仓分红参考</div>
      <p>
        {reference ? dividendReferenceNote(reference) : "正在读取账户股数。这不会读取本机持仓。"}
      </p>
      <div className="hero qk-tabular">
        {reference?.totalCashCny == null ? "—" : `${reference.totalCashCny} 元`}
      </div>
      <p className="hint">
        {reference?.asOf ? `统计截止 ${reference.asOf}` : "尚无可用的统计日期"}
        {reference?.partial ? " · 合计不完整" : ""}
      </p>
      {error ? <p className="hint">{error}</p> : null}
    </section>
  );
}
