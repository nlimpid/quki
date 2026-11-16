import { dividendReferenceNote, type DividendReference } from "@quki/analytics";
import { useEffect, useState } from "react";

import { fetchAccountHoldings, HoldingsRequestError } from "../lib/holdingsAccount.js";
import { usesAccountHoldings, type AuthPhase } from "../lib/authState.js";
import { useAuth } from "../lib/auth.js";

export const HOLDINGS_ESTIMATE_LOADING = "正在读取账户股数。这不会读取本机持仓。";
export const HOLDINGS_ESTIMATE_EXPIRED = "登录状态已失效，无法读取账户股数。本机持仓未改动。";
export const HOLDINGS_ESTIMATE_UNAVAILABLE = "账户持仓暂不可用。本机持仓未改动。";

type EstimateState =
  | { status: "loading" }
  | { status: "ready"; reference: DividendReference }
  | { status: "expired" }
  | { status: "unavailable" };

export function HoldingsEstimateCard() {
  const { phase } = useAuth();
  return <HoldingsEstimate phase={phase} />;
}

export function HoldingsEstimate({
  phase,
  fetchImpl = fetch,
}: {
  phase: AuthPhase;
  fetchImpl?: typeof fetch;
}) {
  const visible = usesAccountHoldings(phase);
  const [state, setState] = useState<EstimateState>({ status: "loading" });

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    fetchAccountHoldings(fetchImpl)
      .then((body) => {
        if (!cancelled) setState({ status: "ready", reference: body.reference });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        if (reason instanceof HoldingsRequestError && reason.status === 401) {
          setState({ status: "expired" });
          return;
        }
        setState({ status: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [visible, fetchImpl]);

  if (!visible) return null;
  const message =
    state.status === "loading"
      ? HOLDINGS_ESTIMATE_LOADING
      : state.status === "expired"
        ? HOLDINGS_ESTIMATE_EXPIRED
        : state.status === "unavailable"
          ? HOLDINGS_ESTIMATE_UNAVAILABLE
          : dividendReferenceNote(state.reference);
  return (
    <section className="card estimate-card">
      <div className="pos-kicker">持仓分红参考</div>
      <p>{message}</p>
      <div className="hero qk-tabular">
        {state.status === "ready" && state.reference.totalCashCny != null
          ? `${state.reference.totalCashCny} 元`
          : "—"}
      </div>
    </section>
  );
}
