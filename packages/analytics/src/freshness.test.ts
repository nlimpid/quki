import { describe, expect, it } from "vitest";

import {
  assessFreshness,
  expectedTradingSession,
  isShanghaiTradingDay,
  previousTradingDay,
  retryWindowClosed,
  sessionCovers,
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

  it("does not close the retry window at 16:30, 18:00, or 18:30", () => {
    // 2026-11-19 is a Thursday. 08:30Z = 16:30, 10:00Z = 18:00, 10:30Z = 18:30.
    expect(retryWindowClosed(new Date("2026-11-19T08:30:00.000Z"))).toBe(false);
    expect(retryWindowClosed(new Date("2026-11-19T10:00:00.000Z"))).toBe(false);
    expect(retryWindowClosed(new Date("2026-11-19T10:30:00.000Z"))).toBe(false);
    expect(retryWindowClosed(new Date("2026-11-19T12:29:00.000Z"))).toBe(false);
  });

  it("closes the retry window at 20:30 Shanghai on a trading day", () => {
    expect(retryWindowClosed(new Date("2026-11-19T12:30:00.000Z"))).toBe(true);
    expect(retryWindowClosed(new Date("2026-11-19T12:35:00.000Z"))).toBe(true);
    expect(retryWindowClosed(new Date("2026-11-21T12:30:00.000Z"))).toBe(false);
  });
});

describe("session coverage", () => {
  it("does not treat the previous session as the expected day", () => {
    expect(sessionCovers("2026-11-18", "2026-11-19")).toBe(false);
    expect(sessionCovers(null, "2026-11-19")).toBe(false);
    expect(sessionCovers("2026-11-19", "2026-11-19")).toBe(true);
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
    expect(report.alert).toBe(true);
    expect(report.calendarKnown).toBe(true);
  });

  it("is not an alert before the 20:30 retry, even when the session is already expected", () => {
    // 18:35 Shanghai on Thursday 2026-11-19. Expected session is today; CSI may still be late.
    const report = assessFreshness({
      now: new Date("2026-11-19T10:35:00.000Z"),
      asOf: "2026-11-18T10:08:00.000Z",
      indexThrough: "2026-11-18",
      indexIncomplete: false,
      lastSuccess: { job: "cron_incremental", at: "2026-11-19T10:05:00.000Z" },
    });
    expect(report.expectedSession).toBe("2026-11-19");
    expect(report.stale).toBe(true);
    expect(report.indexStale).toBe(true);
    expect(report.alert).toBe(false);
  });

  it("alerts after the retry window when the book is still on the previous session", () => {
    const report = assessFreshness({
      now: new Date("2026-11-19T12:35:00.000Z"),
      asOf: "2026-11-18T10:08:00.000Z",
      indexThrough: "2026-11-18",
      indexIncomplete: false,
    });
    expect(report.expectedSession).toBe("2026-11-19");
    expect(report.stale).toBe(true);
    expect(report.alert).toBe(true);
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
    expect(report.alert).toBe(false);
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
