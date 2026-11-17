import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("chart library boundary", () => {
  it("scans source text for attribution and the chart stylesheet boundary", () => {
    const files = [
      "apps/web/src/components/KlineChart.tsx",
      "apps/web/src/components/RotationChart.tsx",
      "apps/web/src/components/VisibleRangeControl.tsx",
      "apps/web/src/components/chartAttribution.tsx",
      "apps/web/src/styles.css",
      "apps/web/package.json",
    ];
    const sources = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(sources).toContain("attributionLogo: true");
    expect(sources).not.toContain("attributionLogo: false");
    expect(sources).toContain("https://www.tradingview.com/");
    const css = readFileSync("apps/web/src/styles.css", "utf8");
    expect(css).toContain('@import "@heroui/styles/components/button.css"');
    expect(css).toContain('@import "@heroui/styles/components/drawer.css"');
    expect(css).toContain('@import "@heroui/styles/components/table.css"');
    expect(css).not.toMatch(/@import "@heroui\/styles";/);
    expect(sources).toContain("BandFillPrimitive");
    expect(sources).toContain("可见区间起点");
    expect(sources).toContain("可见区间终点");
    expect(sources).toContain("index={index}");
    const routes = readFileSync("apps/web/src/main.tsx", "utf8");
    expect(routes).toContain("import.meta.env.DEV");
    expect(routes).toContain('path: "/preview/chart-fixtures"');
    expect(sources).not.toMatch(/from ["']echarts/);
    expect(sources).not.toMatch(/"echarts"/);
    expect(sources).not.toMatch(/@unovis|@visx|recharts|chart\.js/);
  });
});
