import { PHASE1_INSTRUMENTS, type Overview, type Period, type RangeKey } from "@quki/types";
import { useCallback, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useParams, useSearchParams } from "react-router";

import { AppHeader } from "../components/AppHeader.js";
import { Toolbar } from "../components/Toolbar.js";

const RANGES = new Set<RangeKey>(["1Y", "3Y", "5Y", "10Y", "MAX"]);

export function IndexLayout() {
  const { code = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [asOf, setAsOf] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const known = PHASE1_INSTRUMENTS.some((item) => item.symbol === code);
  const period: Period = params.get("period") === "D" ? "D" : "W";
  const rangeParam = params.get("range");
  const range: RangeKey =
    rangeParam && RANGES.has(rangeParam as RangeKey) ? (rangeParam as RangeKey) : "5Y";

  const onOverview = useCallback((overview: Overview | null, isLoading: boolean) => {
    setLoading(isLoading);
    setAsOf(overview?.asOf);
  }, []);

  function go(nextCode: string, nextPeriod = period, nextRange = range) {
    const search = new URLSearchParams(params);
    search.set("period", nextPeriod);
    search.set("range", nextRange);
    if (!search.get("vol")) search.set("vol", "0");
    const suffix = location.pathname.endsWith("/backtest") ? "/backtest" : "";
    navigate(`/index/${nextCode}${suffix}?${search.toString()}`);
  }

  return (
    <>
      <AppHeader
        code={known ? code : "H30269"}
        search={location.search}
        activeNav={location.pathname.endsWith("/backtest") ? "backtest" : "index"}
      />
      {known ? (
        <Toolbar
          code={code}
          period={period}
          range={range}
          asOf={asOf}
          loading={loading && location.pathname.endsWith(`/index/${code}`)}
          onCode={(next) => go(next)}
          onPeriod={(next) => {
            const search = new URLSearchParams(params);
            search.set("period", next);
            setParams(search);
          }}
          onRange={(next) => {
            const search = new URLSearchParams(params);
            search.set("range", next);
            setParams(search);
          }}
        />
      ) : null}
      <main className="page-main">
        {known ? (
          <Outlet context={{ onOverview }} />
        ) : (
          <section className="card">
            <div className="state">
              未找到指数 {code}
              <div>
                <Link
                  className="text-btn"
                  to="/index/H30269?period=W&range=5Y&vol=0"
                  style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}
                >
                  返回红利低波
                </Link>
              </div>
            </div>
          </section>
        )}
        <footer className="disc">
          <strong>免责声明：</strong>
          本站展示的指数行情、均线与估值分位数据来源于公开信息整理，仅供学习与研究参考，
          <strong>不构成投资建议</strong>
          。市场有风险，决策需独立判断。数据可能存在延迟或遗漏，请以官方与交易通道披露为准。
        </footer>
      </main>
    </>
  );
}

export type LayoutContext = { onOverview: (overview: Overview | null, loading: boolean) => void };
