import { describe, expect, it } from "vitest";

import { applyCninfoPriority } from "@quki/ingest";

import type { SqlConn } from "./client.js";
import {
  assertDividendAuditDatabase,
  dividendAuditUpdateArgs,
  dividendAuditUpdateSql,
  writeDividendSourceAudit,
} from "./dividendAudit.js";

describe("dividend source-priority audit", () => {
  it("refuses the production database and writes audit args on any other name", async () => {
    expect(() =>
      assertDividendAuditDatabase("mysql://user:secret@gateway.example:4000/quki"),
    ).toThrow(/production quki/);
    const decision = applyCninfoPriority(
      "600036",
      {
        exDate: "2026-07-10",
        recordDate: "2026-07-09",
        payDate: null,
        cashPer10: 10,
        planText: "10派10.00元(含税)",
      },
      {
        exDate: "2026-07-10",
        recordDate: "2026-07-09",
        payDate: "2026-07-15",
        cashPer10: 10.5,
        planText: "10派10.50元(含税)",
      },
    );
    const calls: { sql: string; params?: unknown[] }[] = [];
    const conn: SqlConn = {
      async execute(sql, params) {
        calls.push({ sql, params });
        return { rows: [] };
      },
    };
    await expect(
      writeDividendSourceAudit(
        conn,
        "mysql://user:secret@gateway.example:4000/quki?sslaccept=strict",
        decision,
      ),
    ).rejects.toThrow(/production quki/);
    expect(calls).toHaveLength(0);
    await writeDividendSourceAudit(
      conn,
      "mysql://user:secret@gateway.example:4000/quki_ci",
      decision,
    );
    expect(calls).toHaveLength(1);
    expect(dividendAuditUpdateSql()).toContain("impl_plan_profile_em");
    expect(dividendAuditUpdateSql()).toContain("impl_plan_profile_cninfo");
    expect(dividendAuditUpdateSql()).toContain("WHERE code = ? AND ex_dividend_date = ?");
    const args = dividendAuditUpdateArgs(decision);
    expect(args[0]).toBe("10.500000");
    expect(args.at(-2)).toBe("600036");
    expect(args.at(-1)).toBe("2026-07-10");
    expect(JSON.stringify(calls[0]?.params)).toContain("10派10.00元(含税)");
    expect(JSON.stringify(calls[0]?.params)).toContain("10派10.50元(含税)");
  });
});
