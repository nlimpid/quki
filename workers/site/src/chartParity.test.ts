import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("chart library boundary", () => {
  it("keeps TradingView attribution and does not import ECharts", () => {
    const files = [
      "apps/web/src/components/KlineChart.tsx",
      "apps/web/src/components/RotationChart.tsx",
      "apps/web/src/components/chartAttribution.tsx",
      "apps/web/src/styles.css",
      "apps/web/package.json",
    ];
    const sources = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(sources).toContain("attributionLogo: true");
    expect(sources).not.toContain("attributionLogo: false");
    expect(sources).toContain("https://www.tradingview.com/");
    expect(sources).toContain('@import "@heroui/styles"');
    expect(sources).not.toMatch(/from ["']echarts/);
    expect(sources).not.toMatch(/"echarts"/);
    expect(sources).not.toMatch(/@unovis|@visx|recharts|chart\.js/);
  });
});
