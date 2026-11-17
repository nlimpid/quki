import { Button } from "@heroui/react";
import { safeReturnTo } from "@quki/types";
import { NavLink, useLocation } from "react-router";

import { AccountMenu } from "./AccountMenu.js";
import { SessionBanner } from "./SessionBanner.js";
import { useAuth } from "../lib/auth.js";
import { headerControl, showExpiryBanner, showRelogin } from "../lib/authState.js";
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
  const location = useLocation();
  const { phase, logout, expiryDismissed, dismissExpiry, recheck } = useAuth();
  const control = headerControl(phase);
  const onLogin = location.pathname === "/login";
  const returnTo = safeReturnTo(`${location.pathname}${location.search}`, window.location.origin);
  const loginTo = onLogin
    ? `${location.pathname}${location.search}`
    : `/login?returnTo=${encodeURIComponent(returnTo)}`;
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
  const account =
    phase.kind === "authenticated" ||
    phase.kind === "logoutPending" ||
    phase.kind === "logoutFailed"
      ? phase
      : null;
  return (
    <>
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
          <Button
            isIconOnly
            variant="ghost"
            onPress={toggle}
            aria-label={theme === "dark" ? "切换浅色模式" : "切换深色模式"}
          >
            {theme === "dark" ? "☀" : "☾"}
          </Button>
          {control === "spinner" ? (
            <div className="auth-slot" aria-busy="true">
              <span className="auth-spinner" />
              <span className="sr-only">正在确认登录状态</span>
            </div>
          ) : null}
          {control === "login" ? (
            <NavLink
              to={loginTo}
              className="auth-header-btn"
              aria-current={onLogin ? "page" : undefined}
              onClick={() => recheck()}
            >
              登录
            </NavLink>
          ) : null}
          {control === "account" && account ? (
            <AccountMenu
              displayName={account.displayName}
              pending={phase.kind === "logoutPending"}
              failed={phase.kind === "logoutFailed"}
              onLogout={() => {
                void logout();
              }}
            />
          ) : null}
        </div>
      </header>
      {showExpiryBanner(phase, expiryDismissed) ? (
        <SessionBanner
          onClose={dismissExpiry}
          onRecheck={recheck}
          showRelogin={showRelogin(phase, expiryDismissed)}
        />
      ) : null}
    </>
  );
}
