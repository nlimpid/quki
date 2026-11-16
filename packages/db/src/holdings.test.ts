import { describe, expect, it } from "vitest";

import type { SqlConn } from "./client.js";
import { createHoldingsStore, lookupHoldingCash } from "./holdings.js";
import { createHoldingsMemory } from "./holdingsMemory.js";

describe("holdings sql", () => {
  it("scopes writes to the session user and keeps codes in parameters", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const conn: SqlConn = {
      async execute(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        if (sql.startsWith("SELECT code, shares")) return { rows: [] };
        if (sql.includes("CAST(ttm_cash_per_share AS CHAR)")) {
          return {
            rows: [
              { code: "000001", name: "平安银行", ttm_cash: "0.25", yield_as_of: "2026-11-14" },
            ],
          };
        }
        return { rows: [], rowsAffected: 1 };
      },
    };
    const store = createHoldingsStore(() => conn);
    const now = new Date("2026-11-16T00:00:00.000Z");
    await store.replaceAll(
      "user-a",
      [{ code: "000001", shares: 40, updatedAt: now.toISOString() }],
      now,
    );
    expect(calls.every((call) => call.params[0] === "user-a")).toBe(true);
    expect(calls.some((call) => call.sql.includes("000001"))).toBe(false);
    expect(calls.some((call) => call.params.includes("000001"))).toBe(true);
    const quotes = await lookupHoldingCash(conn, ["000001", "000001' OR '1'='1"]);
    const lookup = calls.at(-1);
    expect(lookup?.sql).toContain("code IN (?)");
    expect(lookup?.sql).not.toContain("000001'");
    expect(lookup?.params).toEqual(["000001"]);
    expect(quotes).toEqual([
      { code: "000001", name: "平安银行", ttmCashPerShare: "0.25", yieldAsOf: "2026-11-14" },
    ]);
  });
});

describe("holdings memory stand-in", () => {
  it("sets an exact quantity and does not add a second import", async () => {
    const store = createHoldingsMemory();
    const now = new Date("2026-11-16T00:00:00.000Z");
    await store.replaceAll(
      "user-a",
      [{ code: "000001", shares: 100, updatedAt: now.toISOString() }],
      now,
    );
    await store.setExact(
      "user-a",
      [
        { code: "000001", shares: 40, updatedAt: now.toISOString() },
        { code: "600519", shares: 10, updatedAt: now.toISOString() },
      ],
      now,
    );
    expect(await store.list("user-a")).toEqual([
      { code: "000001", shares: 40, updatedAt: now.toISOString() },
      { code: "600519", shares: 10, updatedAt: now.toISOString() },
    ]);
    expect(await store.list("user-b")).toEqual([]);
    expect(store.writes.filter((write) => write.mode === "set")).toHaveLength(1);
  });
});
