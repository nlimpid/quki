import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("crawler cron", () => {
  it("runs at 16:30 Beijing and retries at 18:00, weekdays", () => {
    const text = readFileSync("workers/crawler/wrangler.jsonc", "utf8");
    expect(text).toContain('"30 8 * * 1-5"');
    expect(text).toContain('"0 10 * * 1-5"');
    expect(text).not.toContain("15 8 * * 1-5");
  });

  it("runs the dividend ingest on the weekday cron and ships the migration", () => {
    const worker = readFileSync("workers/crawler/src/index.ts", "utf8");
    expect(worker).toContain("ingestDividends");
    expect(worker).toContain("0004_dividends.sql");
    expect(worker).toContain("0005_dividend_audit.sql");
    expect(worker).toContain('ingestDividends(connectTiDb(databaseUrl), "incremental")');
  });
});
