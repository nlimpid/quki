/**
 * Offline dividend accuracy check. Reconcile and missed-event joins run in an
 * in-memory DuckDB. Production stays on TiDB Serverless; this script does not
 * open it. DIVIDEND_GOLDEN_LIVE=1 refetches Eastmoney only. DIVIDEND_AUDIT_WRITE
 * is refused: migration 0005 is not applied here.
 */
import { checkDividendInvariants } from "@quki/db";
import {
  CASH_PER_10_TOLERANCE,
  breaksToCsv,
  cashPer10Close,
  eastmoneyRawRows,
  fetchEastmoneyDividendsByCode,
  goldenCodes,
  goldenDividends,
  goldenEastmoneyRaw,
  missedEventFixture,
  parserDiffReport,
  selectImplementedDividend,
} from "@quki/ingest";

import { runLocalDividendQa } from "./dividendQaDuckdb.js";

const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

const golden = goldenDividends();
const qa = await runLocalDividendQa();
const reconciled = qa.reconciled;
process.stdout.write(breaksToCsv(reconciled));
if (qa.engine !== "duckdb") fail(`local QA engine ${qa.engine}`);
if (reconciled.length !== 12 || reconciled.some((row) => row.status !== "MATCH")) {
  fail(`golden reconcile expected 12 MATCH, got ${reconciled.map((row) => row.status).join(",")}`);
}

const diff = parserDiffReport(eastmoneyRawRows());
if (diff.compared !== 20 || diff.disagreements.length > 0) {
  fail(`parser diff compared ${diff.compared}, disagreements ${diff.disagreements.length}`);
}

const missed = missedEventFixture();
if (JSON.stringify(qa.missing) !== JSON.stringify(missed.expectedMissing)) {
  fail(`missed-event scan ${JSON.stringify(qa.missing)}`);
}

for (const event of golden) {
  const parsed = selectImplementedDividend(goldenEastmoneyRaw(event));
  if (!parsed) {
    fail(`parser dropped ${event.code} ${event.ex_dividend_date}`);
    continue;
  }
  const broken = checkDividendInvariants(parsed);
  if (broken.length > 0)
    fail(`${event.code} invariants ${broken.map((item) => item.name).join(",")}`);
  if (parsed.exDividendDate !== event.ex_dividend_date) {
    fail(`${event.code} ex ${parsed.exDividendDate}`);
  }
  if (parsed.equityRecordDate !== event.equity_record_date) {
    fail(`${event.code} record ${parsed.equityRecordDate}`);
  }
  if (
    !cashPer10Close(Number(parsed.cashPer10), event.cash_div_pretax_per_10, CASH_PER_10_TOLERANCE)
  ) {
    fail(`${event.code} cash ${parsed.cashPer10}`);
  }
}

if (process.env.DIVIDEND_AUDIT_WRITE === "1") {
  console.error(
    "Refusing DIVIDEND_AUDIT_WRITE. This script does not open TiDB. 0005_dividend_audit.sql is not applied.",
  );
  process.exit(1);
}

if (process.env.DIVIDEND_GOLDEN_LIVE === "1") {
  for (const code of goldenCodes()) {
    try {
      const page = await fetchEastmoneyDividendsByCode(code);
      const implemented = page.rows.flatMap((row) => {
        const event = selectImplementedDividend(row);
        return event ? [event] : [];
      });
      for (const want of golden.filter((event) => event.code === code)) {
        const got = implemented.find((event) => event.exDividendDate === want.ex_dividend_date);
        if (!got) {
          fail(`live missing ${want.code} ${want.ex_dividend_date}`);
          continue;
        }
        if (got.equityRecordDate !== want.equity_record_date) {
          fail(`live record ${want.code} ${got.equityRecordDate}`);
        }
        if (!cashPer10Close(Number(got.cashPer10), want.cash_div_pretax_per_10)) {
          fail(`live cash ${want.code} ${got.cashPer10}`);
        }
      }
    } catch (error) {
      fail(`live ${code}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

if (failures.length > 0) {
  for (const message of failures) console.error(message);
  process.exit(1);
}

console.log(
  `dividend golden check ok: ${golden.length} events, parser rows ${diff.compared}, breaks 0, tolerance ${CASH_PER_10_TOLERANCE}, engine ${qa.engine}`,
);
