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

describe("signed-in portfolio lists account rows without dividend figures", () => {
  it("keeps the dividend summary out of the account row component", () => {
    const board = readFileSync(new URL("./holdingBoard.tsx", import.meta.url), "utf8");
    expect(board).not.toContain("预估全年分红");
    expect(board).not.toContain("portfolioDividendSummary");
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
        return Response.json({ items: [], isSample: true });
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
    expect(text).toContain("000001");
    expect(text).toContain("10");
    expect(text).not.toContain("预估全年分红");
    expect(text).not.toContain("组合平均股息率");
    expect(text).not.toContain("¥20.00");
    expect(text).not.toContain("添加账户持仓");
    expect(text).not.toContain("此浏览器里没有旧持仓。添加股票");
    expect(document.querySelectorAll("button").length).toBeGreaterThan(0);
    expect(calls.some((call) => call.url.includes("/api/stocks/batch"))).toBe(false);
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

  it("shows the account read failure without a loading line", async () => {
    installDom();
    localStorage.setItem(
      "qk.holdings.v1",
      JSON.stringify({
        version: 1,
        items: [{ code: "000002", shares: 5, updatedAt: "2026-11-18T00:00:00.000Z" }],
      }),
    );
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/session")) return Response.json(session);
      if (url.includes("/api/holdings")) {
        return Response.json({ message: "登录暂不可用" }, { status: 503 });
      }
      return new Response("no", { status: 404 });
    }) as typeof fetch;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    await act(async () => {
      root.render(
        <ThemeProvider>
          <MemoryRouter initialEntries={["/portfolio"]}>
            <AuthProvider sessionKey="ready:fixture" getAccessToken={async () => "fixture-token"}>
              <PortfolioPage />
            </AuthProvider>
          </MemoryRouter>
        </ThemeProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("登录暂不可用");
    expect(text).not.toContain("正在读取账户持仓");
    expect(text).not.toContain("尚未添加持仓");
    await act(async () => {
      root.unmount();
    });
  });
});
