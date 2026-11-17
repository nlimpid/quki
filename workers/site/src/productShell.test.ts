import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("product shell stays visual", () => {
  it("keeps login on the previous palette and moves dividend pages onto paper", () => {
    const css = read("design/tokens-dividends.css");
    const auth = css.slice(css.indexOf(".auth-app {"), css.indexOf("[data-theme"));
    expect(auth).toContain("--qk-canvas: #eef1f4;");
    expect(auth).toContain("--qk-accent: #4f46e5;");
    expect(auth).not.toContain("#f4f1ea");
    const dividends = css.slice(0, css.indexOf(".auth-app {"));
    expect(dividends).toContain("--qk-canvas: #f4f1ea;");
    expect(dividends).toContain("--qk-accent: #1c1916;");
    expect(read("apps/web/src/pages/LoginPage.tsx")).toContain('className="auth-app"');
    expect(read("apps/web/src/pages/LoginPage.tsx")).not.toContain("qk-product");
  });

  it("applies the shared shell to backtest, rotation, and dividend pages only", () => {
    const layout = read("apps/web/src/pages/IndexLayout.tsx");
    expect(layout).toContain('onBacktest ? "qk-product" : "qk-index"');
    expect(read("apps/web/src/pages/DividendShell.tsx")).toContain("dividends-app qk-product");
    expect(read("apps/web/src/pages/RotationPage.tsx")).toContain('className="qk-product"');
    const shell = read("apps/web/src/product-shell.css");
    expect(shell).toMatch(/\.qk-product\.dividends-app \{[^}]*min-height: 100dvh;/s);
    expect(shell).toContain(".qk-product .metric .v.quote-stale");
    expect(shell).toContain(".qk-product .table__cell.quote-stale");
    expect(shell.indexOf(".qk-product .metric .v.quote-stale")).toBeGreaterThan(
      shell.indexOf(".qk-product .metric .v,"),
    );
    expect(read("apps/web/src/pages/LoginPage.tsx")).not.toContain("qk-product");
    expect(read("design/tokens-dividends.css")).toContain(".auth-app {");
    expect(read("apps/web/src/pages/IndexLayout.tsx")).toContain('"qk-index"');
  });

  it("covers remaining product words in the Source Han subset", () => {
    const css = read("apps/web/src/fonts.css");
    const covered = new Set<number>();
    for (const match of css.matchAll(/U\+([0-9A-F]+)(?:-([0-9A-F]+))?/g)) {
      const start = Number.parseInt(match[1] ?? "0", 16);
      const end = Number.parseInt(match[2] ?? match[1] ?? "0", 16);
      for (let code = start; code <= end; code += 1) covered.add(code);
    }
    const words = [
      "偏离度",
      "存储不可用",
      "分红详情尚未接入",
      "爬虫会从中证指数拉取",
      "贵州茅台",
      "五粮液",
      "宁德时代",
      "平安银行",
      "中芯国际",
      "扣税后",
    ];
    const missing = [...new Set(words.join(""))].filter((char) => !covered.has(char.charCodeAt(0)));
    expect(missing).toEqual([]);
  });
});
