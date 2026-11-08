import { describe, expect, it } from "vitest";

import { breaksToCsv, missedEventFixture } from "@quki/ingest";

import { LOCAL_QA_ENGINE, reconcileCsvInDuckdb, runLocalDividendQa } from "./dividendQaDuckdb.js";

describe("local dividend QA in DuckDB", () => {
  it("matches the golden 12 and reports the missed fixture row", async () => {
    const qa = await runLocalDividendQa();
    expect(qa.engine).toBe(LOCAL_QA_ENGINE);
    expect(LOCAL_QA_ENGINE).toBe("duckdb");
    expect(qa.reconciled).toHaveLength(12);
    expect(qa.reconciled.every((row) => row.status === "MATCH")).toBe(true);
    expect(qa.reconciled.every((row) => row.cashAgree === true && row.recordAgree === true)).toBe(
      true,
    );
    expect(breaksToCsv(qa.reconciled).trim().split("\n")).toHaveLength(1);
    const maotai = qa.reconciled.find(
      (row) => row.code === "600519" && row.exDate === "2026-06-26",
    );
    expect(maotai?.cashBySource.sina).toBeCloseTo(280.242, 6);
    expect(maotai?.cashBySource.eastmoney).toBeCloseTo(280.2423, 6);
    expect(qa.missing).toEqual(missedEventFixture().expectedMissing);
  });

  it("flags a cninfo cash break from a CSV join", async () => {
    const csv = [
      "source,code,name,ex_dividend_date,equity_record_date,cash_div_pretax_per_10,impl_plan_profile",
      "eastmoney,600036,招商银行,2026-07-10,2026-07-09,10.03,10派10.03元(含税)",
      "cninfo,600036,招商银行,2026-07-10,2026-07-09,10.50,10派10.50元(含税)",
      "sina,600036,招商银行,2026-07-10,2026-07-09,10.03,",
    ].join("\n");
    const rows = await reconcileCsvInDuckdb(`${csv}\n`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("CASH_MISMATCH");
    expect(breaksToCsv(rows)).toContain("CASH_MISMATCH");
  });
});
