import {
  IMPLEMENTED_PROGRESS,
  PLAN_CASH_EPSILON,
  parsePlanCashPer10,
  type NormalizedDividend,
} from "@quki/ingest";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type DividendInvariantFailure = {
  name: string;
  detail: string;
};

export type DividendInvariantStats = {
  skipped: number;
  byCheck: Record<string, number>;
};

export function emptyInvariantStats(): DividendInvariantStats {
  return { skipped: 0, byCheck: {} };
}

export function recordInvariantFailure(
  stats: DividendInvariantStats,
  failures: readonly DividendInvariantFailure[],
): void {
  stats.skipped += 1;
  for (const failure of failures) {
    stats.byCheck[failure.name] = (stats.byCheck[failure.name] ?? 0) + 1;
  }
}

function amount(value: string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * Pre-insert checks for one implemented dividend. An empty list means the row may be upserted.
 * Missing record or notice dates skip the cross-date checks. Plan text is checked only when
 * both the profile and the numeric cash are present and the profile contains 派X元.
 */
export function checkDividendInvariants(event: NormalizedDividend): DividendInvariantFailure[] {
  const failures: DividendInvariantFailure[] = [];
  const tag = `${event.code}@${event.exDividendDate || "?"}`;
  if (!DATE.test(event.exDividendDate)) {
    failures.push({
      name: "has_ex_date",
      detail: `${tag} ex_dividend_date=${event.exDividendDate || "null"}`,
    });
  }
  const cash = amount(event.cashPer10);
  const bonus = amount(event.bonusPer10);
  const transfer = amount(event.transferPer10);
  if (cash != null && !(cash >= 0)) {
    failures.push({
      name: "cash_non_negative",
      detail: `${tag} cash_div_pretax_per_10=${event.cashPer10}`,
    });
  }
  if (bonus != null && !(bonus >= 0)) {
    failures.push({
      name: "bonus_non_negative",
      detail: `${tag} bonus_ratio_per_10=${event.bonusPer10}`,
    });
  }
  if (transfer != null && !(transfer >= 0)) {
    failures.push({
      name: "transfer_non_negative",
      detail: `${tag} transfer_ratio_per_10=${event.transferPer10}`,
    });
  }
  if (
    DATE.test(event.exDividendDate) &&
    event.equityRecordDate &&
    DATE.test(event.equityRecordDate) &&
    event.exDividendDate < event.equityRecordDate
  ) {
    failures.push({
      name: "ex_after_or_on_record",
      detail: `${tag} equity_record_date=${event.equityRecordDate} ex_dividend_date=${event.exDividendDate}`,
    });
  }
  if (
    event.noticeDate &&
    DATE.test(event.exDividendDate) &&
    DATE.test(event.noticeDate) &&
    event.noticeDate > event.exDividendDate
  ) {
    failures.push({
      name: "notice_before_or_on_ex",
      detail: `${tag} notice_date=${event.noticeDate} ex_dividend_date=${event.exDividendDate}`,
    });
  }
  if (event.assignProgress !== IMPLEMENTED_PROGRESS) {
    failures.push({
      name: "progress_implemented",
      detail: `${tag} assign_progress=${event.assignProgress}`,
    });
  }
  const nonzero =
    (cash != null && cash > 0) ||
    (bonus != null && bonus > 0) ||
    (transfer != null && transfer > 0);
  if (!nonzero) {
    failures.push({
      name: "nonzero_distribution",
      detail: `${tag} cash=${event.cashPer10} bonus=${event.bonusPer10} transfer=${event.transferPer10}`,
    });
  }
  if (event.implPlanProfile && cash != null && Number.isFinite(cash)) {
    const parsed = parsePlanCashPer10(event.implPlanProfile);
    if (parsed != null && Math.abs(parsed - cash) >= PLAN_CASH_EPSILON) {
      failures.push({
        name: "plan_text_matches_cash",
        detail: `${tag} plan=${parsed} cash_div_pretax_per_10=${cash}`,
      });
    }
  }
  return failures;
}
