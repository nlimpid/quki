import type { SourcePriorityDecision } from "@quki/ingest";

import type { SqlConn } from "./client.js";
import { databaseNameFromUrl } from "./temperatureStore.js";

export function assertDividendAuditDatabase(url: string): void {
  const name = databaseNameFromUrl(url);
  if (name.toLowerCase() === "quki" || name.length === 0) {
    throw new Error(
      `Refusing to write dividend audit rows to database "${name || "(missing)"}". Apply is manual and must not target production quki.`,
    );
  }
}

export function dividendAuditUpdateSql(): string {
  return `
    UPDATE dividend_events
    SET cash_div_pretax_per_10 = ?,
        cash_div_pretax_per_share = ?,
        ex_dividend_date = ?,
        pay_cash_date = ?,
        impl_plan_profile = ?,
        cash_source = ?,
        ex_dividend_date_source = ?,
        pay_cash_date_source = ?,
        cash_div_pretax_per_10_em = ?,
        cash_div_pretax_per_10_cninfo = ?,
        ex_dividend_date_em = ?,
        ex_dividend_date_cninfo = ?,
        pay_cash_date_em = ?,
        pay_cash_date_cninfo = ?,
        impl_plan_profile_em = ?,
        impl_plan_profile_cninfo = ?,
        source_overridden = ?
    WHERE code = ? AND ex_dividend_date = ?
  `;
}

export function dividendAuditUpdateArgs(decision: SourcePriorityDecision): unknown[] {
  const cash = decision.cashDivPretaxPer10;
  return [
    cash == null ? null : cash.toFixed(6),
    cash == null || cash === 0 ? null : (cash / 10).toFixed(8),
    decision.exDividendDate,
    decision.payCashDate,
    decision.implPlanProfile,
    decision.cashSource,
    decision.exSource,
    decision.paySource === "none" ? null : decision.paySource,
    decision.audit.cash_div_pretax_per_10_em,
    decision.audit.cash_div_pretax_per_10_cninfo,
    decision.audit.ex_dividend_date_em,
    decision.audit.ex_dividend_date_cninfo,
    decision.audit.pay_cash_date_em,
    decision.audit.pay_cash_date_cninfo,
    decision.audit.impl_plan_profile_em,
    decision.audit.impl_plan_profile_cninfo,
    decision.overridden.length > 0 ? 1 : 0,
    decision.code,
    decision.locateExDate,
  ];
}

/** Writes audit columns from migration 0005. Refuses the production database name. */
export async function writeDividendSourceAudit(
  conn: SqlConn,
  databaseUrl: string,
  decision: SourcePriorityDecision,
): Promise<void> {
  assertDividendAuditDatabase(databaseUrl);
  if (!decision.locateExDate) {
    throw new Error(
      `dividend audit for ${decision.code} has no eastmoney ex_dividend_date to locate`,
    );
  }
  await conn.execute(dividendAuditUpdateSql(), dividendAuditUpdateArgs(decision));
}
