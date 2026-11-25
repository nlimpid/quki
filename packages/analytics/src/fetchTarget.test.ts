import { describe, expect, it } from "vitest";

import { expectedTradingSession } from "./freshness.js";
import { fetchTargetSession } from "./fetchTarget.js";

describe("fetch target session", () => {
  it("targets Monday before 18:30, while health still expects Friday", () => {
    const now = new Date("2026-11-23T08:30:00.000Z");
    expect(fetchTargetSession(now)).toBe("2026-11-23");
    expect(expectedTradingSession(now)).toBe("2026-11-20");
  });

  it("targets the trading day at 16:30, 18:00, 18:29, and 18:30", () => {
    for (const now of [
      "2026-11-25T08:30:00.000Z",
      "2026-11-25T10:00:00.000Z",
      "2026-11-25T10:29:00.000Z",
      "2026-11-25T10:30:00.000Z",
    ]) {
      expect(fetchTargetSession(new Date(now))).toBe("2026-11-25");
    }
    expect(expectedTradingSession(new Date("2026-11-25T10:29:00.000Z"))).toBe("2026-11-24");
    expect(expectedTradingSession(new Date("2026-11-25T10:30:00.000Z"))).toBe("2026-11-25");
  });

  it("targets Friday on Saturday and Sunday", () => {
    expect(fetchTargetSession(new Date("2026-11-21T02:00:00.000Z"))).toBe("2026-11-20");
    expect(fetchTargetSession(new Date("2026-11-22T12:00:00.000Z"))).toBe("2026-11-20");
  });

  it("targets the previous open session on a 2026 SSE closure", () => {
    expect(fetchTargetSession(new Date("2026-10-01T10:00:00.000Z"))).toBe("2026-09-30");
    expect(fetchTargetSession(new Date("2026-05-01T04:00:00.000Z"))).toBe("2026-04-30");
  });
});
