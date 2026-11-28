import { describe, expect, it } from "vitest";

import { crawlSessionStatus } from "@quki/analytics";

/** Mirrors `incrementalFailures`: one omitted target fails the whole pass. */
function aggregateIncremental(input: {
  symbols: readonly { symbol: string; through: string | null; failed?: boolean }[];
  now: Date;
}): { failedSymbols: string[]; sessionMissing: string[]; cron: "success" | "failed" } {
  const failedSymbols: string[] = [];
  const sessionMissing: string[] = [];
  for (const item of input.symbols) {
    if (item.failed) {
      failedSymbols.push(item.symbol);
      continue;
    }
    const session = crawlSessionStatus({
      mode: "incremental",
      through: item.through,
      now: input.now,
    });
    if (session.sessionMissing) sessionMissing.push(item.symbol);
  }
  return {
    failedSymbols,
    sessionMissing,
    cron: failedSymbols.length === 0 && sessionMissing.length === 0 ? "success" : "failed",
  };
}

describe("incremental aggregation", () => {
  const now = new Date("2026-11-25T10:00:00.000Z");

  it("fails the cron when one index omits the target and the others have it", () => {
    const result = aggregateIncremental({
      now,
      symbols: [
        { symbol: "000300", through: "2026-11-25" },
        { symbol: "000905", through: "2026-11-24" },
        { symbol: "000852", through: "2026-11-25" },
      ],
    });
    expect(result.sessionMissing).toEqual(["000905"]);
    expect(result.failedSymbols).toEqual([]);
    expect(result.cron).toBe("failed");
    expect(crawlSessionStatus({ mode: "incremental", through: "2026-11-25", now }).status).toBe(
      "success",
    );
  });

  it("keeps a transport failure distinct from a missing target", () => {
    const result = aggregateIncremental({
      now,
      symbols: [
        { symbol: "H20903", through: null, failed: true },
        { symbol: "000922", through: "2026-11-20" },
      ],
    });
    expect(result.failedSymbols).toEqual(["H20903"]);
    expect(result.sessionMissing).toEqual(["000922"]);
    expect(result.cron).toBe("failed");
  });

  it("is success only when every symbol covers the target", () => {
    const result = aggregateIncremental({
      now,
      symbols: [
        { symbol: "000300", through: "2026-11-25" },
        { symbol: "H00922", through: "2026-11-25" },
      ],
    });
    expect(result.cron).toBe("success");
  });
});
