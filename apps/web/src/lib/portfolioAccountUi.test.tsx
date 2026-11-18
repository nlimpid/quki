import { readFileSync } from "node:fs";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

import { PortfolioPage } from "../pages/PortfolioPage.js";
import { AuthProvider } from "./auth.js";
import { ThemeProvider } from "./theme.js";

/**
 * Fixture session only. Happy DOM does not load CSS, so this is not a visual proof.
 * Not a Clerk OTP login and not a user account.
 */
function installDom() {
  const window = new Window();
  Object.assign(globalThis, {
    window,
    document: window.document,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    Node: window.Node,
    NodeFilter: window.NodeFilter,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    SVGElement: window.SVGElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
}

const session = {
  status: "authenticated",
  authenticated: true,
  expired: false,
  user: { id: "fixture-user", displayName: null },
  csrfToken: "csrf-fixture",
  login: { ready: true, method: "clerk", reason: null },
};

describe("signed-in portfolio shows account dividend figures from the quote pipeline", () => {
  it("renders dividend figures only when metrics are passed in", () => {
    const board = readFileSync(new URL("./holdingBoard.tsx", import.meta.url), "utf8");
    expect(board).toContain("metrics ?");
    expect(board).toContain("预估全年分红");
    expect(board).toContain("hold-grid");
    expect(board).toContain("icon-text");
  });

  it("shows one add entry, confirms delete, and clears the row on account switch", async () => {
    installDom();
    const calls: { method: string; url: string }[] = [];
    const holdings = {
      current: [
        {
          code: "000001",
          shares: 10,
          version: "a".repeat(32),
          updatedAt: "2026-11-18 00:00:00.000",
        },
      ],
    };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url });
      if (url.includes("/api/auth/session")) return Response.json(session);
      if (url.includes("/api/holdings")) {
        if (method === "DELETE") {
          holdings.current = [];
          return new Response(null, { status: 204 });
        }
        return Response.json({ items: holdings.current });
      }
      if (url.includes("/api/stocks/batch")) {
        return Response.json({
          items: [
            {
              code: "000001",
              name: "名称000001",
              exchange: "SZ",
              board: "main",
              lastClose: 10,
              quoteFresh: true,
              trailingYieldPct: 20,
              ttmCashPerShare: 2,
              lastCashDivDate: null,
              lastCashPer10: null,
            },
          ],
          isSample: true,
        });
      }
      return new Response("no", { status: 404 });
    }) as typeof fetch;

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    function Harness() {
      const [sessionKey, setSessionKey] = useState("ready:A");
      return (
        <ThemeProvider>
        <MemoryRouter initialEntries={["/portfolio"]}>
          <button
            id="switch-b"
            type="button"
            onClick={() => {
              holdings.current = [];
              setSessionKey("ready:B");
            }}
          />
          <AuthProvider
            sessionKey={sessionKey}
            getAccessToken={async () => (sessionKey === "ready:A" ? "token-A" : "token-B")}
          >
            <PortfolioPage />
          </AuthProvider>
        </MemoryRouter>
        </ThemeProvider>
      );
    }
    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("名称000001");
    expect(text).toContain("10");
    expect(text).toContain("预估全年分红");
    expect(text).toContain("组合平均股息率");
    expect(text).toContain("¥20.00");
    expect(text).not.toContain("¥0.00");
    expect(text).not.toContain("添加账户持仓");
    expect(calls.some((call) => call.url.includes("/api/stocks/batch"))).toBe(true);
    expect(calls.some((call) => call.method === "PUT" || call.method === "DELETE")).toBe(false);

    expect(document.querySelector('button[aria-label="编辑"]')).toBeTruthy();

    const remove = document.getElementById("delete-000001") as HTMLButtonElement;
    await act(async () => {
      remove.click();
    });
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    expect(remove.getAttribute("aria-label")).toBe("确认删除");
    await act(async () => {
      remove.click();
    });
    expect(
      calls.some((call) => call.method === "DELETE" && call.url.includes("/api/holdings/000001")),
    ).toBe(true);

    await act(async () => {
      document.getElementById("switch-b")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.body.textContent).not.toContain("000001");
    expect(document.body.textContent).toContain("尚未添加持仓");
    await act(async () => {
      root.unmount();
    });
  });
});
