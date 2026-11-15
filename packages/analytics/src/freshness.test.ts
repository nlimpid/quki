import { describe, expect, it } from "vitest";

import {
  assessFreshness,
  expectedTradingSession,
  isShanghaiTradingDay,
  previousTradingDay,
} from "./freshness.js";

describe("Shanghai trading calendar", () => {
  it("treats Friday 2026-11-13 as a session and Sunday 2026-11-08 as closed", () => {
    expect(isShanghaiTradingDay("2026-11-13")).toBe(true);
    expect(isShanghaiTradingDay("2026-11-08")).toBe(false);
    expect(isShanghaiTradingDay("2026-11-14")).toBe(false);
  });

  it("skips the 2026 National Day closure and lands on the next open session", () => {
    expect(isShanghaiTradingDay("2026-10-01")).toBe(false);
    expect(isShanghaiTradingDay("2026-10-07")).toBe(false);
    expect(isShanghaiTradingDay("2026-10-08")).toBe(true);
    expect(previousTradingDay("2026-05-06")).toBe("2026-04-30");
  });
});

describe("expected trading session", () => {
  it("still expects Thursday before 18:30 Shanghai on Friday", () => {
    expect(expectedTradingSession(new Date("2026-11-13T10:29:00.000Z"))).toBe("2026-11-12");
  });

  it("expects Friday once the 18:00 retry window has closed", () => {
    expect(expectedTradingSession(new Date("2026-11-13T10:30:00.000Z"))).toBe("2026-11-13");
  });

  it("keeps expecting Friday on Saturday morning", () => {
    expect(expectedTradingSession(new Date("2026-11-14T02:30:00.000Z"))).toBe("2026-11-13");
  });
});

describe("assessFreshness", () => {
  const fridayEvening = new Date("2026-11-13T12:30:00.000Z");

  it("flags the Thursday crawl when Friday's session never landed", () => {
    const report = assessFreshness({
      now: fridayEvening,
      asOf: "2026-11-12T10:08:49.000Z",
      indexThrough: "2026-11-11",
      indexIncomplete: false,
    });
    expect(report.expectedSession).toBe("2026-11-13");
    expect(report.quotesStale).toBe(true);
    expect(report.indexStale).toBe(true);
    expect(report.stale).toBe(true);
    expect(report.calendarKnown).toBe(true);
  });

  it("is fresh when quotes and the lagging index include Friday", () => {
    const report = assessFreshness({
      now: fridayEvening,
      asOf: "2026-11-13T10:08:00.000Z",
      indexThrough: "2026-11-13",
      indexIncomplete: false,
      lastSuccess: { job: "cron_incremental", at: "2026-11-13T10:08:00.000Z" },
    });
    expect(report.stale).toBe(false);
    expect(report.quotesStale).toBe(false);
    expect(report.indexStale).toBe(false);
    expect(report.lastSuccess?.job).toBe("cron_incremental");
  });

  it("stays stale when one index has no bars", () => {
    const report = assessFreshness({
      now: fridayEvening,
      asOf: "2026-11-13T10:08:00.000Z",
      indexThrough: "2026-11-13",
      indexIncomplete: true,
    });
    expect(report.quotesStale).toBe(false);
    expect(report.indexStale).toBe(true);
    expect(report.stale).toBe(true);
  });
});
