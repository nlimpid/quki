import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("portfolio layout styles", () => {
  it("keeps the index temperature figure from leaking onto dividend cards", () => {
    const css = readFileSync("apps/web/src/styles.css", "utf8");
    expect(css).toContain(".pos .hero {\n  font-size: 32px;");
    expect(css).toContain(".pos .hero {\n    font-size: 32px;");
    expect(css).not.toMatch(/(^|\n)\.hero \{/);
  });

  it("stacks the holdings drawer above the sticky header and lets it scroll", () => {
    const css = readFileSync("apps/web/src/dividends.css", "utf8");
    expect(css).toContain("z-index: var(--qk-z-modal);");
    expect(css).toContain("min-height: 0;");
    expect(css).toContain("overflow: auto;");
    expect(css).not.toContain("z-index: 30;");
  });
});
