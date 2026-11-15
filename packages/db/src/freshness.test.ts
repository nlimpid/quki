import { describe, expect, it } from "vitest";

import type { SqlConn } from "./client.js";
import { readMarketFreshness, recordCronRun } from "./freshness.js";

describe("readMarketFreshness", () => {
  it("reads quote asOf, the lagging index, and the latest success", async () => {
    const conn: SqlConn = {
      async execute(sql) {
        if (sql.includes("MAX(updated_at)")) {
          return { rows: [{ updated_at: "2026-11-12 10:08:49.000" }] };
        }
        if (sql.includes("per_index")) {
          return { rows: [{ index_through: "2026-11-11", missing: 0, symbols: 8 }] };
        }
        if (sql.includes("crawl_runs")) {
          return {
            rows: [{ job_name: "dividends_events", finished_at: "2026-11-12 10:08:49.000" }],
          };
        }
        throw new Error(sql);
      },
    };
    const report = await readMarketFreshness(conn, new Date("2026-11-13T12:30:00.000Z"));
    expect(report.asOf).toBe("2026-11-12T10:08:49.000Z");
    expect(report.indexThrough).toBe("2026-11-11");
    expect(report.expectedSession).toBe("2026-11-13");
    expect(report.stale).toBe(true);
    expect(report.lastSuccess).toEqual({
      job: "dividends_events",
      at: "2026-11-12T10:08:49.000Z",
    });
  });

  it("treats an index with no bars as incomplete", async () => {
    const conn: SqlConn = {
      async execute(sql) {
        if (sql.includes("MAX(updated_at)")) return { rows: [{ updated_at: null }] };
        if (sql.includes("per_index")) {
          return { rows: [{ index_through: "2026-11-13", missing: 1, symbols: 8 }] };
        }
        return { rows: [] };
      },
    };
    const report = await readMarketFreshness(conn, new Date("2026-11-13T12:30:00.000Z"));
    expect(report.indexStale).toBe(true);
    expect(report.lastSuccess).toBeNull();
  });
});

describe("recordCronRun", () => {
  it("writes a cron_incremental row without a dividend audit column", async () => {
    const calls: { sql: string; params?: unknown[] }[] = [];
    const conn: SqlConn = {
      async execute(sql, params) {
        calls.push({ sql, params });
        return { rows: [] };
      },
    };
    await recordCronRun(conn, {
      status: "failed",
      cron: "0 10 * * MON-FRI",
      error: "x".repeat(800),
    });
    const call = calls[0];
    expect(call?.sql).toContain("cron_incremental");
    expect(call?.sql).not.toContain("audit");
    expect(call?.params?.[0]).toBe("failed");
    expect(call?.params?.[1]).toBe("0 10 * * MON-FRI");
    expect(String(call?.params?.[2])).toHaveLength(500);
  });
});
