import { readFileSync } from "node:fs";

import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

const suites = [
  "apps/web/src/lib/accountBook.test.ts",
  "apps/web/src/lib/localImport.test.ts",
  "apps/web/src/lib/portfolioAccount.test.ts",
];

describe("mounted account tests resolve happy-dom by package name", () => {
  it("does not point at a pnpm store path", () => {
    for (const file of suites) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain('from "happy-dom"');
      expect(source).not.toContain("node_modules/.pnpm");
      expect(source).not.toContain("happy-dom@");
    }
  });

  it("constructs a window from the installed package", () => {
    const window = new Window();
    expect(window.document.createElement("button").tagName).toBe("BUTTON");
    window.close();
  });
});
