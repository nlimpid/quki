import { describe, expect, it } from "vitest";

import { crawlSessionStatus } from "./crawlSession.js";

describe("crawl session status", () => {
  const thursdayEvening = new Date("2026-11-19T10:35:00.000Z");

  it("does not call a previous-session CSI payload a success", () => {
    const result = crawlSessionStatus({
      mode: "incremental",
      through: "2026-11-18",
      now: thursdayEvening,
    });
    expect(result.expectedSession).toBe("2026-11-19");
    expect(result.sessionMissing).toBe(true);
    expect(result.status).toBe("partial");
  });

  it("is a success when the stored bar is the expected session", () => {
    const result = crawlSessionStatus({
      mode: "incremental",
      through: "2026-11-19",
      now: thursdayEvening,
    });
    expect(result.sessionMissing).toBe(false);
    expect(result.status).toBe("success");
  });

  it("does not fail a backfill that stops before today", () => {
    const result = crawlSessionStatus({
      mode: "backfill",
      through: "2026-11-03",
      now: thursdayEvening,
    });
    expect(result.sessionMissing).toBe(false);
    expect(result.status).toBe("success");
  });

  it("is missing before 18:30 when today is the fetch target but not the health session", () => {
    const result = crawlSessionStatus({
      mode: "incremental",
      through: "2026-11-18",
      now: new Date("2026-11-19T08:30:00.000Z"),
    });
    expect(result.expectedSession).toBe("2026-11-18");
    expect(result.targetSession).toBe("2026-11-19");
    expect(result.sessionMissing).toBe(true);
    expect(result.status).toBe("partial");
  });

  it("is a success before 18:30 once the fetch target is stored", () => {
    const result = crawlSessionStatus({
      mode: "incremental",
      through: "2026-11-19",
      now: new Date("2026-11-19T08:30:00.000Z"),
    });
    expect(result.expectedSession).toBe("2026-11-18");
    expect(result.targetSession).toBe("2026-11-19");
    expect(result.sessionMissing).toBe(false);
    expect(result.status).toBe("success");
  });
});
