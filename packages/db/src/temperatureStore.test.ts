import { describe, expect, it } from "vitest";

import type { SqlConn } from "./client.js";
import {
  TEMPERATURE_BOOTSTRAP_SESSIONS,
  assertBacktestDatabase,
  persistTemperature,
  rowsForTemperatureWrite,
  temperatureBacktestInsertSql,
  temperatureUpsertSql,
} from "./temperatureStore.js";
import type { TemperaturePoint } from "@quki/analytics";

function point(date: string): TemperaturePoint {
  return { date, temperature: 40, pa: 30, pb: 55, spread40: 0.01, ratio: 1.02, ma55: 1000 };
}

function points(count: number): TemperaturePoint[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(2010, 0, 1 + index));
    return point(date.toISOString().slice(0, 10));
  });
}

describe("temperature writes", () => {
  it("drops stored dates and caps the first incremental tail", () => {
    const decision = { action: "append" as const, reason: "append" as const };
    const series = [point("2026-11-03"), point("2026-11-04"), point("2026-11-05")];
    expect(
      rowsForTemperatureWrite({
        points: series,
        decision: { action: "skip", reason: "unchanged" },
        storedThrough: "2026-11-05",
        latestAlignedDate: "2026-11-05",
        mode: "incremental",
      }),
    ).toEqual([]);
    expect(
      rowsForTemperatureWrite({
        points: series,
        decision,
        storedThrough: "2026-11-04",
        latestAlignedDate: "2026-11-05",
        mode: "incremental",
      }).map((row) => row.date),
    ).toEqual(["2026-11-05"]);

    const many = points(TEMPERATURE_BOOTSTRAP_SESSIONS + 25);
    const boot = rowsForTemperatureWrite({
      points: many,
      decision,
      storedThrough: null,
      latestAlignedDate: many[many.length - 1]?.date ?? "",
      mode: "incremental",
    });
    expect(boot).toHaveLength(TEMPERATURE_BOOTSTRAP_SESSIONS);
    expect(boot[0]?.date).toBe(many[25]?.date);
    expect(boot[boot.length - 1]?.date).toBe(many[many.length - 1]?.date);
  });

  it("does not upsert analytics rows when the source date is unchanged", async () => {
    const sql: string[] = [];
    const conn: SqlConn = {
      async execute(statement) {
        sql.push(statement);
        if (statement.includes("ORDER BY trade_date DESC")) {
          return { rows: [{ trade_date: "2026-11-04" }] };
        }
        return { rows: [] };
      },
    };
    const result = await persistTemperature(conn, {
      instrumentId: "1",
      params: { study: "dividend_temperature", ver: 1, mapping: "quantile", w: 0.5 },
      broadSymbol: "H20903",
      points: [point("2026-11-03"), point("2026-11-04")],
      latestAlignedDate: "2026-11-04",
      latestPriceDate: "2026-11-04",
      mode: "incremental",
    });
    expect(result).toMatchObject({ action: "skip", reason: "unchanged", written: 0 });
    expect(sql.some((statement) => statement.includes("INSERT INTO analytics_series"))).toBe(false);
    expect(sql.some((statement) => statement.includes("DELETE FROM analytics_series"))).toBe(false);
  });

  it("appends only the new session and uses VALUES(col)", async () => {
    const writes: { sql: string; args: unknown[] }[] = [];
    const conn: SqlConn = {
      async execute(statement, args) {
        writes.push({ sql: statement, args: args ?? [] });
        if (statement.includes("ORDER BY trade_date DESC")) {
          return { rows: [{ trade_date: "2026-11-03" }] };
        }
        return { rows: [] };
      },
    };
    const result = await persistTemperature(conn, {
      instrumentId: "7",
      params: { study: "dividend_temperature", ver: 1, mapping: "quantile", w: 0.5 },
      broadSymbol: "H20903",
      points: [point("2026-11-03"), point("2026-11-04")],
      latestAlignedDate: "2026-11-04",
      latestPriceDate: "2026-11-04",
      mode: "incremental",
    });
    expect(result).toMatchObject({ action: "append", written: 1, through: "2026-11-04" });
    const insert = writes.find((write) => write.sql.includes("INSERT INTO analytics_series"));
    expect(insert).toBeDefined();
    expect(insert?.sql).toContain("metric_value = VALUES(metric_value)");
    expect(insert?.sql).not.toContain("AS new");
    expect(insert?.args).toContain("2026-11-04");
    expect(insert?.args).not.toContain("2026-11-03");
    expect(temperatureUpsertSql(1)).toContain("VALUES(extra)");
    expect(temperatureUpsertSql(1)).not.toContain("AS new");
  });

  it("refuses a production database and keeps the backtest insert off the row alias", () => {
    expect(() => assertBacktestDatabase("mysql://user:secret@gateway.example:4000/quki")).toThrow(
      /production/,
    );
    expect(() =>
      assertBacktestDatabase("mysql://user:secret@gateway.example:4000/quki?sslaccept=strict"),
    ).toThrow(/production/);
    expect(() =>
      assertBacktestDatabase("mysql://user:secret@gateway.example:4000/quki_ci"),
    ).not.toThrow();
    expect(temperatureBacktestInsertSql()).toContain("dividend_temperature_v1");
    expect(temperatureBacktestInsertSql()).not.toContain("AS new");
  });
});
