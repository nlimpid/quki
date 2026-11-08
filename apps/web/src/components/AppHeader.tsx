import { NavLink } from "react-router";

import { useTheme } from "../lib/theme.js";

export type ActiveNav = "index" | "backtest" | "rotation" | "stocks" | "portfolio";

export function AppHeader({
  code = "H30269",
  search = "",
  activeNav = "index",
}: {
  code?: string;
  search?: string;
  activeNav?: ActiveNav;
}) {
  const { theme, toggle } = useTheme();
  const query = search || "?period=W&range=5Y&vol=0";
  const indexHref = `/index/${code}${query}`;
  const showIndexLinks =
    activeNav === "index" || activeNav === "backtest" || activeNav === "rotation";
  const item = (id: ActiveNav, to: string, label: string) => (
    <NavLink
      to={to}
      className={() => (activeNav === id ? "active" : "")}
      aria-current={activeNav === id ? "page" : undefined}
    >
      {label}
    </NavLink>
  );
  return (
    <header className="app-header">
      <div className="header-left">
        <NavLink to={indexHref} className="brand">
          <span className="brand-name">quki</span>
          <span className="brand-sub">指数估值</span>
        </NavLink>
        <nav className="main-nav" aria-label="主导航">
          {item("index", indexHref, "指数")}
          {item("stocks", "/stocks", "个股")}
          {item("portfolio", "/portfolio", "持仓")}
          {showIndexLinks ? <span className="nav-split" aria-hidden="true" /> : null}
          {showIndexLinks ? item("backtest", `/index/${code}/backtest${query}`, "回测") : null}
          {showIndexLinks ? item("rotation", "/rotation/h00922-h20903?range=5Y", "轮动") : null}
        </nav>
      </div>
      <div className="header-right">
        <span className="stub-login">登录即将推出</span>
        <button
          type="button"
          className="icon-btn"
          onClick={toggle}
          aria-label={theme === "dark" ? "切换浅色模式" : "切换深色模式"}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </div>
    </header>
  );
}
