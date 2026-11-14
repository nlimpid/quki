import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("site wrangler configs", () => {
  it("lets a root wrangler preview find the site worker", () => {
    const root = readFileSync("wrangler.jsonc", "utf8");
    const site = readFileSync("workers/site/wrangler.jsonc", "utf8");
    expect(root).toContain('"name": "quki"');
    expect(root).toContain('"main": "workers/site/src/index.ts"');
    expect(root).toContain('"directory": "apps/web/dist"');
    expect(site).toContain('"main": "src/index.ts"');
    expect(site).toContain('"directory": "../../apps/web/dist"');
    expect(root).toContain('"pattern": "quki.cc"');
    expect(site).toContain('"pattern": "quki.cc"');
  });
});
