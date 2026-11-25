import { describe, expect, it, vi } from "vitest";

import {
  fetchIncrementalCsindex,
  incrementalCsindexWindows,
  type CsindexWindow,
} from "./csindexFetch.js";
import type { FetchLike } from "./csindex.js";

function jsonResponse(rows: unknown[]): Response {
  return Response.json({ code: "200", msg: "Success", data: rows, success: true });
}

function row(tradeDate: string, close: number) {
  return { tradeDate, close, change: 1, changePct: 0.1 };
}

function urls(fetchImpl: ReturnType<typeof vi.fn>): string[] {
  return fetchImpl.mock.calls.map((call) => String(call[0]));
}

describe("incremental CSIndex windows", () => {
  const windows = (stored: string | null, target: string): CsindexWindow[] =>
    incrementalCsindexWindows({
      storedThrough: stored,
      shanghaiToday: "2026-11-25",
      targetSession: target,
      baseDate: "2005-01-04",
    });

  it("asks for the stored session through today, then the target day", () => {
    expect(windows("2026-11-20", "2026-11-25")).toEqual([
      { startDate: "2026-11-20", endDate: "2026-11-25", role: "primary" },
      { startDate: "2026-11-25", endDate: "2026-11-25", role: "target-day" },
    ]);
  });

  it("does not add a second request when the primary window is already the target day", () => {
    expect(windows("2026-11-25", "2026-11-25")).toEqual([
      { startDate: "2026-11-25", endDate: "2026-11-25", role: "primary" },
    ]);
  });

  it("uses the base date when nothing is stored", () => {
    expect(windows(null, "2026-11-25")[0]).toEqual({
      startDate: "2005-01-04",
      endDate: "2026-11-25",
      role: "primary",
    });
  });
});

describe("fetchIncrementalCsindex", () => {
  const plan = incrementalCsindexWindows({
    storedThrough: "2026-11-20",
    shanghaiToday: "2026-11-25",
    targetSession: "2026-11-25",
    baseDate: "2005-01-04",
  });

  it("does not call the target day when the primary 200 already has it", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      jsonResponse([row("20261120", 100), row("20261125", 110)]),
    );
    const result = await fetchIncrementalCsindex({
      symbol: "H20903",
      windows: plan,
      targetSession: "2026-11-25",
      startAlreadyStored: true,
      fetchImpl,
    });
    expect(result.covered).toBe(true);
    expect(result.windowsFetched).toEqual([plan[0]]);
    expect(urls(fetchImpl)).toEqual([
      "https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode=H20903&startDate=20261120&endDate=20261125",
    ]);
    expect(result.bars.map((bar) => bar.date)).toEqual(["2026-11-20", "2026-11-25"]);
  });

  it("keeps a stale 200 and stores only the target-day fallback rows", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url) => {
      if (String(url).includes("startDate=20261125"))
        return jsonResponse([row("20261125", 4508.27)]);
      return jsonResponse([row("20261120", 4574)]);
    });
    const result = await fetchIncrementalCsindex({
      symbol: "H20903",
      windows: plan,
      targetSession: "2026-11-25",
      startAlreadyStored: true,
      fetchImpl,
    });
    expect(result.covered).toBe(true);
    expect(result.windowsFetched.map((window) => window.role)).toEqual(["primary", "target-day"]);
    expect(urls(fetchImpl)[1]).toContain("startDate=20261125&endDate=20261125");
    expect(result.bars.find((bar) => bar.date === "2026-11-25")?.close).toBe("4508.270000");
    expect(result.bars.find((bar) => bar.date === "2026-11-20")?.close).toBe("4574.000000");
  });

  it("does not invent a bar when both 200 bodies omit the target", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => jsonResponse([]));
    const result = await fetchIncrementalCsindex({
      symbol: "000905",
      windows: plan,
      targetSession: "2026-11-25",
      fetchImpl,
    });
    expect(result.covered).toBe(false);
    expect(result.bars).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not relabel an old close onto the target date", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url) =>
      String(url).includes("startDate=20261125")
        ? jsonResponse([row("20261120", 1)])
        : jsonResponse([row("20261120", 1)]),
    );
    const result = await fetchIncrementalCsindex({
      symbol: "000852",
      windows: plan,
      targetSession: "2026-11-25",
      fetchImpl,
    });
    expect(result.covered).toBe(false);
    expect(result.bars.map((bar) => bar.date)).toEqual(["2026-11-20"]);
  });
});
