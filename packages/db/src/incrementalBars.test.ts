import { describe, expect, it, vi } from "vitest";

import { crawlSessionStatus } from "@quki/analytics";
import type { FetchLike } from "@quki/ingest";

import { loadIncrementalBars } from "./jobs.js";

function jsonResponse(rows: unknown[]): Response {
  return Response.json({ code: "200", msg: "Success", data: rows, success: true });
}

function row(tradeDate: string, close: number) {
  return { tradeDate, close, change: 1, changePct: 0.1 };
}

function urls(fetchImpl: ReturnType<typeof vi.fn>): string[] {
  return fetchImpl.mock.calls.map((call) => String(call[0]));
}

const mondayMorning = new Date("2026-11-23T08:30:00.000Z");
const wednesday1630 = new Date("2026-11-25T08:30:00.000Z");

describe("loadIncrementalBars", () => {
  it("does not call a stored target a success when the target day is missing from both 200s", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse([row("20261120", 4574)]));
    const loaded = await loadIncrementalBars({
      symbol: "H20903",
      mode: "incremental",
      storedThrough: "2026-11-20",
      now: mondayMorning,
      baseDate: "2005-01-04",
      fetchImpl,
    });
    expect(loaded.targetSession).toBe("2026-11-23");
    expect(loaded.bars.map((bar) => bar.date)).toEqual(["2026-11-20"]);
    expect(urls(fetchImpl)).toEqual([
      "https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=H20903&startDate=20261120&endDate=20261123",
      "https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=H20903&startDate=20261123&endDate=20261123",
    ]);
    const status = crawlSessionStatus({
      mode: "incremental",
      through: loaded.bars.at(-1)?.date ?? "2026-11-20",
      now: mondayMorning,
    });
    expect(status.expectedSession).toBe("2026-11-20");
    expect(status.sessionMissing).toBe(true);
    expect(status.status).toBe("partial");
  });

  it("stores the target-day close and nothing dated as the target from the stale window", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url) =>
      String(url).includes("startDate=20261125")
        ? jsonResponse([row("20261125", 5890.41)])
        : jsonResponse([]),
    );
    const loaded = await loadIncrementalBars({
      symbol: "000905",
      mode: "incremental",
      storedThrough: "2026-11-24",
      now: wednesday1630,
      baseDate: "2004-12-31",
      fetchImpl,
    });
    expect(loaded.bars).toEqual([
      expect.objectContaining({ date: "2026-11-25", close: "5890.410000" }),
    ]);
    const status = crawlSessionStatus({
      mode: "incremental",
      through: "2026-11-25",
      now: wednesday1630,
    });
    expect(status.status).toBe("success");
    expect(status.expectedSession).toBe("2026-11-24");
  });

  it("keeps a backfill that stops before the target as success and uses the base date", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse([row("20261103", 1)]));
    const loaded = await loadIncrementalBars({
      symbol: "000922",
      mode: "backfill",
      storedThrough: "2026-11-20",
      now: wednesday1630,
      baseDate: "2004-12-31",
      fetchImpl,
    });
    expect(urls(fetchImpl)).toEqual([
      "https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=000922&startDate=20041231&endDate=20261125",
    ]);
    expect(loaded.bars.map((bar) => bar.date)).toEqual(["2026-11-03"]);
    expect(
      crawlSessionStatus({ mode: "backfill", through: "2026-11-03", now: wednesday1630 }).status,
    ).toBe("success");
  });

  it("asks a holiday run for the previous open session", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url) =>
      String(url).includes("startDate=20260930")
        ? jsonResponse([row("20260930", 3)])
        : jsonResponse([row("20260929", 2)]),
    );
    const loaded = await loadIncrementalBars({
      symbol: "000300",
      mode: "incremental",
      storedThrough: "2026-09-29",
      now: new Date("2026-10-01T10:00:00.000Z"),
      baseDate: "2004-12-31",
      fetchImpl,
    });
    expect(loaded.targetSession).toBe("2026-09-30");
    expect(urls(fetchImpl)[1]).toContain("startDate=20260930&endDate=20260930");
    expect(loaded.bars.map((bar) => bar.date)).toEqual(["2026-09-29", "2026-09-30"]);
  });

  it("asks a weekend run for Friday, not the closed day", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url) =>
      String(url).includes("startDate=20261120")
        ? jsonResponse([row("20261120", 2)])
        : jsonResponse([]),
    );
    const loaded = await loadIncrementalBars({
      symbol: "000852",
      mode: "incremental",
      storedThrough: "2026-11-19",
      now: new Date("2026-11-21T04:00:00.000Z"),
      baseDate: "2004-12-31",
      fetchImpl,
    });
    expect(loaded.targetSession).toBe("2026-11-20");
    expect(urls(fetchImpl)[1]).toContain("startDate=20261120&endDate=20261120");
    expect(
      crawlSessionStatus({
        mode: "incremental",
        through: loaded.bars.at(-1)?.date ?? null,
        now: new Date("2026-11-21T04:00:00.000Z"),
      }).status,
    ).toBe("success");
  });
});
