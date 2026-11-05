import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("crawler cron", () => {
  it("runs at 16:30 Beijing and retries at 18:00, weekdays", () => {
    const text = readFileSync("workers/crawler/wrangler.jsonc", "utf8");
    expect(text).toContain('"30 8 * * 1-5"');
    expect(text).toContain('"0 10 * * 1-5"');
    expect(text).not.toContain("15 8 * * 1-5");
  });
});
