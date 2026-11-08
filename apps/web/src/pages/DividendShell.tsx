import type { ReactNode } from "react";

import { DIVIDEND_DISCLAIMER } from "@quki/types";

import { AppHeader, type ActiveNav } from "../components/AppHeader.js";

export function DividendShell({
  activeNav,
  children,
}: {
  activeNav: Extract<ActiveNav, "stocks" | "portfolio">;
  children: ReactNode;
}) {
  return (
    <div className="dividends-app">
      <AppHeader activeNav={activeNav} />
      <main className="div-main">{children}</main>
      <footer className="div-foot">
        <strong>免责声明：</strong>
        {DIVIDEND_DISCLAIMER}
      </footer>
    </div>
  );
}
