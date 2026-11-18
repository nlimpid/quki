import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("product search field has one border", () => {
  it("removes the native search box and keeps focus on the group", () => {
    const css = readFileSync("apps/web/src/product-shell.css", "utf8");
    const rule = css.slice(css.indexOf(".qk-product .search-field__group {"));
    expect(rule).toContain("appearance: none");
    expect(rule).toContain("border: 1px solid var(--qk-rule-2)");
    expect(rule).toContain(".qk-product .search-field__group:focus-within");
    expect(rule).toContain("outline: 2px solid var(--qk-focus)");
    expect(rule).toMatch(/\.search-field__input:focus-visible,\s*\.qk-product \.input:focus-visible \{\s*outline: none;/);
  });
});
