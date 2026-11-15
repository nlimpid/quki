import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { WEEKDAY_CRONS, isCatchUpCron, scheduledIngest } from "./schedule.js";

describe("crawler cron", () => {
  it("runs Monday–Friday at 16:30 and 18:00 Beijing, and checks again at 20:30", () => {
    const text = readFileSync("workers/crawler/wrangler.jsonc", "utf8");
    for (const cron of WEEKDAY_CRONS) expect(text).toContain(`"${cron}"`);
    expect(text).not.toMatch(/"\d+ \d+ \* \* [0-9]-[0-9]"/);
    expect(text).not.toContain("15 8 * *");
    expect(text).toContain('"observability"');
  });

  it("does not treat a numeric weekday range as Monday–Friday", () => {
    expect(isCatchUpCron("30 12 * * MON-FRI")).toBe(true);
    expect(isCatchUpCron("30 12 * * mon-fri")).toBe(true);
    expect(isCatchUpCron("30 8 * * MON-FRI")).toBe(false);
    expect(isCatchUpCron("0 10 * * 2-6")).toBe(false);
    expect(scheduledIngest("30 8 * * MON-FRI", false)).toBe(true);
    expect(scheduledIngest("0 10 * * MON-FRI", false)).toBe(true);
    expect(scheduledIngest("30 12 * * MON-FRI", false)).toBe(false);
    expect(scheduledIngest("30 12 * * MON-FRI", true)).toBe(true);
    expect(scheduledIngest("30 12 * * MON-FRI", null)).toBe(true);
  });

  it("runs dividends before index bars and records the cron outcome", () => {
    const worker = readFileSync("workers/crawler/src/index.ts", "utf8");
    expect(worker).toContain("ingestDividends");
    expect(worker).toContain("0004_dividends.sql");
    expect(worker).toContain("0005_dividend_audit.sql");
    expect(worker).toContain('ingestDividends(connectTiDb(databaseUrl), "incremental")');
    const run = worker.slice(worker.indexOf("async function runIncremental"));
    const dividends = run.indexOf("await ingestDividends");
    const bars = run.indexOf("await ingestAll");
    expect(dividends).toBeGreaterThan(-1);
    expect(bars).toBeGreaterThan(dividends);
    expect(worker).toContain("recordCronRun");
    expect(worker).toContain("readMarketFreshness");
  });
});
