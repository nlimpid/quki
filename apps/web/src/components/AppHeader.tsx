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
            <span className="nav-split" aria-hidden="true" />
            {item("backtest", `/index/${code}/backtest${query}`, "回测")}
            {item("rotation", "/rotation/h00922-h20903?range=5Y", "轮动")}
          </nav>
        </div>
        <div className="header-right">
          <Button
            isIconOnly
            className="theme-toggle"
            variant="ghost"
            onPress={toggle}
            aria-label={theme === "dark" ? "切换浅色模式" : "切换深色模式"}
          >
            {theme === "dark" ? (
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <path
                  d="M8 1.4v1.7M8 12.9v1.7M1.4 8h1.7M12.9 8h1.7M3.3 3.3l1.2 1.2M11.5 11.5l1.2 1.2M3.3 12.7l1.2-1.2M11.5 4.5l1.2-1.2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M9.2 2.1a5.4 5.4 0 1 0 4.6 8.1A4.3 4.3 0 1 1 9.2 2.1z"
                />
              </svg>
            )}
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
