import { NavLink } from "react-router";

import { useTheme } from "../lib/theme.js";

export function AppHeader({ code, search }: { code: string; search: string }) {
  const { theme, toggle } = useTheme();
  const query = search || "?period=W&range=5Y&vol=0";
  return (
    <header className="app-header">
      <div className="header-left">
        <NavLink to={`/index/H30269?period=W&range=5Y&vol=0`} className="brand">
          <span className="brand-name">quki</span>
          <span className="brand-sub">指数估值</span>
        </NavLink>
        <nav className="main-nav" aria-label="主导航">
          <NavLink to={`/index/${code}${query}`} end>
            概览
          </NavLink>
          <NavLink to={`/index/${code}/backtest${query}`}>回测</NavLink>
          <NavLink to="/rotation/h00922-h20903?range=5Y">轮动</NavLink>
        </nav>
      </div>
      <button
        type="button"
        className="icon-btn"
        onClick={toggle}
        aria-label={theme === "dark" ? "切换浅色模式" : "切换深色模式"}
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>
    </header>
  );
}
