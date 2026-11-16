import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("account holdings do not touch the browser copy by themselves", () => {
  it("reads local holdings only from the import click", () => {
    const source = readFileSync("apps/web/src/components/AccountHoldings.tsx", "utf8");
    const click = source.indexOf("function onImportLocal");
    const read = source.indexOf("readLocalHoldingsForImport()");
    expect(click).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(click);
    expect(source).not.toContain("writeHoldings");
    expect(source).toContain("识图服务尚未选择，图片不会上传。");
    expect(source).toContain("不会把两边相加");
    expect(source).toContain("reviewVisionRows");
    expect(source).toContain("confirmImportRows");
    expect(source).not.toContain("syntheticVision");
  });

  it("keeps the guest portfolio on local storage", () => {
    const source = readFileSync("apps/web/src/pages/PortfolioPage.tsx", "utf8");
    expect(source).toContain("function LocalPortfolio");
    expect(source).toContain("readHoldings");
    expect(source).toContain("accountUserId");
    expect(source).toContain("writeGuestDrawerDraft");
  });
});
