import goldenJson from "./fixtures/dividends/golden-implemented-v1.json" with { type: "json" };
import missedJson from "./fixtures/dividends/missed-events-v1.json" with { type: "json" };
import rawJson from "./fixtures/dividends/eastmoney-raw-v1.json" with { type: "json" };

import { emDate } from "./eastmoneyDividends.js";

/** Yuan per 10 shares. Sina's 280.242 vs Eastmoney 280.2423 stays inside this band. */
export const CASH_PER_10_TOLERANCE = 0.001;
/** Parser A/B float noise. Tighter than the vendor cash tolerance on purpose. */
export const PARSER_DIFF_EPSILON = 1e-9;
export const PLAN_CASH_EPSILON = 1e-6;

const PLAN_CASH = /派\s*([0-9]+(?:\.[0-9]+)?)\s*元/;
const GOLDEN_CODES = ["600036", "601919", "600519", "000001"] as const;

export type AccuracyEvent = {
  source: string;
  code: string;
  name: string | null;
  noticeDate: string | null;
  exDate: string | null;
  recordDate: string | null;
  payDate: string | null;
  cashPer10: number | null;
  bonusPer10: number | null;
  transferPer10: number | null;
  progress: string | null;
  planText: string | null;
};

export type GoldenSourceFields = {
  cash_div_pretax_per_10: number | null;
  equity_record_date: string | null;
  ex_dividend_date: string;
  impl_plan_profile: string | null;
};

export type GoldenEvent = {
  code: string;
  name: string;
  secucode: string;
  assign_progress: string;
  ex_dividend_date: string;
  equity_record_date: string;
  cash_div_pretax_per_10: number;
  impl_plan_profile: string;
  sources: {
    eastmoney: GoldenSourceFields;
    sina: GoldenSourceFields;
    cninfo: GoldenSourceFields;
  };
};

export type ReconcileStatus =
  | "MATCH"
  | "CASH_MISMATCH"
  | "RECORD_MISMATCH"
  | "SECONDARY_MISMATCH"
  | "PARTIAL"
  | "SINGLE";

export type ReconcileRow = {
  code: string;
  exDate: string;
  status: ReconcileStatus;
  sources: string[];
  cashBySource: Record<string, number | null>;
  recordBySource: Record<string, string | null>;
  planBySource: Record<string, string | null>;
  cashAgree: boolean | null;
  recordAgree: boolean | null;
};

export type SourcePrioritySide = {
  exDate: string | null;
  recordDate: string | null;
  payDate: string | null;
  cashPer10: number | null;
  planText: string | null;
};

export type SourcePriorityDecision = {
  code: string;
  exDividendDate: string | null;
  equityRecordDate: string | null;
  payCashDate: string | null;
  cashDivPretaxPer10: number | null;
  implPlanProfile: string | null;
  cashSource: "eastmoney" | "cninfo";
  exSource: "eastmoney" | "cninfo";
  paySource: "eastmoney" | "cninfo" | "none";
  overridden: string[];
  locateExDate: string | null;
  audit: {
    cash_div_pretax_per_10_em: number | null;
    cash_div_pretax_per_10_cninfo: number | null;
    ex_dividend_date_em: string | null;
    ex_dividend_date_cninfo: string | null;
    pay_cash_date_em: string | null;
    pay_cash_date_cninfo: string | null;
    impl_plan_profile_em: string | null;
    impl_plan_profile_cninfo: string | null;
  };
};

export type MissedEventRef = { code: string; ex_dividend_date: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

export function parsePlanCashPer10(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = PLAN_CASH.exec(text);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function cashPer10Close(
  left: number | null,
  right: number | null,
  tolerance = CASH_PER_10_TOLERANCE,
): boolean {
  if (left == null || right == null) return left == null && right == null;
  return Math.abs(left - right) <= tolerance;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`golden fixture missing ${label}`);
  return value;
}

function sourceFields(value: unknown, label: string): GoldenSourceFields {
  if (!isRecord(value)) throw new Error(`golden fixture missing ${label}`);
  const cash = finiteNumber(value.cash_div_pretax_per_10);
  if (cash == null) throw new Error(`golden fixture missing ${label} cash`);
  return {
    cash_div_pretax_per_10: cash,
    equity_record_date: textOrNull(value.equity_record_date),
    ex_dividend_date: requireString(value.ex_dividend_date, `${label} ex_dividend_date`),
    impl_plan_profile: textOrNull(value.impl_plan_profile),
  };
}

function parseGolden(value: unknown): GoldenEvent[] {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.events)) {
    throw new Error("golden dividend fixture is not version 1");
  }
  const tolerances = value.tolerances;
  if (
    !isRecord(tolerances) ||
    tolerances.cash_div_pretax_per_10 !== CASH_PER_10_TOLERANCE ||
    tolerances.equity_record_date !== 0 ||
    tolerances.ex_dividend_date !== 0
  ) {
    throw new Error("golden fixture tolerances drifted from CASH_PER_10_TOLERANCE");
  }
  return value.events.map((row, index) => {
    if (!isRecord(row) || !isRecord(row.sources)) {
      throw new Error(`golden event ${index} is not an object`);
    }
    return {
      code: requireString(row.code, "code"),
      name: requireString(row.name, "name"),
      secucode: requireString(row.secucode, "secucode"),
      assign_progress: requireString(row.assign_progress, "assign_progress"),
      ex_dividend_date: requireString(row.ex_dividend_date, "ex_dividend_date"),
      equity_record_date: requireString(row.equity_record_date, "equity_record_date"),
      cash_div_pretax_per_10: finiteNumber(row.cash_div_pretax_per_10) ?? Number.NaN,
      impl_plan_profile: requireString(row.impl_plan_profile, "impl_plan_profile"),
      sources: {
        eastmoney: sourceFields(row.sources.eastmoney, "eastmoney"),
        sina: sourceFields(row.sources.sina, "sina"),
        cninfo: sourceFields(row.sources.cninfo, "cninfo"),
      },
    };
  });
}

let goldenCache: GoldenEvent[] | null = null;

export function goldenDividends(): GoldenEvent[] {
  if (!goldenCache) {
    const events = parseGolden(goldenJson);
    if (events.length !== 12)
      throw new Error(`golden fixture has ${events.length} events, want 12`);
    for (const code of GOLDEN_CODES) {
      if (events.filter((event) => event.code === code).length !== 3) {
        throw new Error(`golden fixture wants 3 events for ${code}`);
      }
    }
    goldenCache = events;
  }
  return goldenCache;
}

export function goldenCodes(): readonly string[] {
  return GOLDEN_CODES;
}

export function eastmoneyRawRows(): Record<string, unknown>[] {
  if (!isRecord(rawJson) || rawJson.version !== 1 || !Array.isArray(rawJson.rows)) {
    throw new Error("eastmoney raw fixture is not version 1");
  }
  return rawJson.rows.filter(isRecord);
}

export function missedEventFixture(): {
  source: MissedEventRef[];
  dividendEvents: MissedEventRef[];
  expectedMissing: MissedEventRef[];
} {
  if (!isRecord(missedJson) || missedJson.version !== 1) {
    throw new Error("missed-event fixture is not version 1");
  }
  const read = (value: unknown): MissedEventRef[] => {
    if (!Array.isArray(value)) return [];
    return value.filter(isRecord).map((row) => ({
      code: String(row.code ?? ""),
      ex_dividend_date: String(row.ex_dividend_date ?? ""),
    }));
  };
  return {
    source: read(missedJson.source),
    dividendEvents: read(missedJson.dividend_events),
    expectedMissing: read(missedJson.expected_missing),
  };
}

/** Field-first: PRETAX_BONUS_RMB, then plan text. This is the regression parser, not the ingest filter. */
export function parserFieldFirst(raw: Record<string, unknown>, code?: string): AccuracyEvent {
  const resolved =
    code ??
    String(raw.SECURITY_CODE ?? "")
      .trim()
      .padStart(6, "0");
  const field = finiteNumber(raw.PRETAX_BONUS_RMB);
  return {
    source: "parser_a",
    code: resolved,
    name: textOrNull(raw.SECURITY_NAME_ABBR),
    noticeDate: emDate(raw.NOTICE_DATE),
    exDate: emDate(raw.EX_DIVIDEND_DATE),
    recordDate: emDate(raw.EQUITY_RECORD_DATE),
    payDate: emDate(raw.PAY_CASH_DATE),
    cashPer10: field ?? parsePlanCashPer10(textOrNull(raw.IMPL_PLAN_PROFILE)),
    bonusPer10: finiteNumber(raw.BONUS_RATIO),
    transferPer10: finiteNumber(raw.IT_RATIO),
    progress: textOrNull(raw.ASSIGN_PROGRESS),
    planText: textOrNull(raw.IMPL_PLAN_PROFILE),
  };
}

/** Plan text only. Dates use the same calendar parser; bonus and transfer stay empty. */
export function parserPlanTextOnly(raw: Record<string, unknown>, code?: string): AccuracyEvent {
  const resolved =
    code ??
    String(raw.SECURITY_CODE ?? "")
      .trim()
      .padStart(6, "0");
  return {
    source: "parser_b",
    code: resolved,
    name: textOrNull(raw.SECURITY_NAME_ABBR),
    noticeDate: emDate(raw.NOTICE_DATE),
    exDate: emDate(raw.EX_DIVIDEND_DATE),
    recordDate: emDate(raw.EQUITY_RECORD_DATE),
    payDate: null,
    cashPer10: parsePlanCashPer10(textOrNull(raw.IMPL_PLAN_PROFILE)),
    bonusPer10: null,
    transferPer10: null,
    progress: textOrNull(raw.ASSIGN_PROGRESS),
    planText: textOrNull(raw.IMPL_PLAN_PROFILE),
  };
}

const DIFF_FIELDS = ["cashPer10", "exDate", "recordDate", "noticeDate", "progress"] as const;

export function diffParserEvents(
  left: AccuracyEvent,
  right: AccuracyEvent,
): Record<string, { a: unknown; b: unknown }> {
  const diffs: Record<string, { a: unknown; b: unknown }> = {};
  for (const field of DIFF_FIELDS) {
    const a = left[field];
    const b = right[field];
    if (a === b) continue;
    if (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= PARSER_DIFF_EPSILON) {
      continue;
    }
    diffs[field] = { a, b };
  }
  return diffs;
}

export function parserDiffReport(rows: readonly Record<string, unknown>[]): {
  compared: number;
  disagreements: {
    code: string;
    exDate: string | null;
    diffs: Record<string, { a: unknown; b: unknown }>;
  }[];
} {
  const disagreements = [];
  for (const raw of rows) {
    const a = parserFieldFirst(raw);
    const b = parserPlanTextOnly(raw);
    const diffs = diffParserEvents(a, b);
    if (Object.keys(diffs).length > 0) {
      disagreements.push({ code: a.code, exDate: a.exDate, diffs });
    }
  }
  return { compared: rows.length, disagreements };
}

export function goldenToAccuracy(
  event: GoldenEvent,
  source: "eastmoney" | "sina" | "cninfo",
): AccuracyEvent {
  const fields = event.sources[source];
  return {
    source,
    code: event.code,
    name: event.name,
    noticeDate: null,
    exDate: fields.ex_dividend_date,
    recordDate: fields.equity_record_date,
    payDate: null,
    cashPer10: fields.cash_div_pretax_per_10,
    bonusPer10: null,
    transferPer10: null,
    progress: event.assign_progress,
    planText: fields.impl_plan_profile,
  };
}

export function reconcileDividendSources(
  bySource: Readonly<Record<string, readonly AccuracyEvent[]>>,
  codes: readonly string[],
  latestN = 3,
): ReconcileRow[] {
  const indexed = new Map<string, Map<string, AccuracyEvent>>();
  for (const [source, events] of Object.entries(bySource)) {
    const index = new Map<string, AccuracyEvent>();
    for (const event of events) {
      if (!event.exDate) continue;
      index.set(`${event.code}|${event.exDate}`, event);
    }
    indexed.set(source, index);
  }
  const rows: ReconcileRow[] = [];
  for (const code of codes) {
    const exDates = new Set<string>();
    for (const index of indexed.values()) {
      for (const key of index.keys()) {
        const [eventCode, exDate] = key.split("|");
        if (eventCode === code && exDate) exDates.add(exDate);
      }
    }
    const ordered = [...exDates].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)).slice(0, latestN);
    for (const exDate of ordered) {
      const cashBySource: Record<string, number | null> = {};
      const recordBySource: Record<string, string | null> = {};
      const planBySource: Record<string, string | null> = {};
      const sources: string[] = [];
      for (const [source, index] of indexed) {
        const event = index.get(`${code}|${exDate}`);
        if (!event) continue;
        sources.push(source);
        cashBySource[source] = event.cashPer10;
        recordBySource[source] = event.recordDate;
        planBySource[source] = event.planText;
      }
      const primary = ["eastmoney", "cninfo"].filter((source) => sources.includes(source));
      const primaryCash = primary.map((source) => cashBySource[source] ?? null);
      const primaryRecord = primary.map((source) => recordBySource[source] ?? null);
      const cashAgree =
        primaryCash.length >= 2
          ? cashPer10Close(primaryCash[0] ?? null, primaryCash[1] ?? null)
          : null;
      const recordAgree = primaryRecord.length >= 2 ? primaryRecord[0] === primaryRecord[1] : null;
      let status: ReconcileStatus;
      if (sources.length <= 1) status = "SINGLE";
      else if (primary.length < 2) status = "PARTIAL";
      else if (cashAgree === false) status = "CASH_MISMATCH";
      else if (recordAgree === false) status = "RECORD_MISMATCH";
      else if (sources.includes("sina")) {
        const anchor = cashBySource.cninfo ?? cashBySource.eastmoney ?? null;
        const sinaCash = cashBySource.sina ?? null;
        const sinaRecord = recordBySource.sina ?? null;
        const anchorRecord = recordBySource.cninfo ?? recordBySource.eastmoney ?? null;
        const sinaCashOk = cashPer10Close(anchor, sinaCash);
        const sinaRecordOk = sinaRecord == null || sinaRecord === anchorRecord;
        status = sinaCashOk && sinaRecordOk ? "MATCH" : "SECONDARY_MISMATCH";
      } else if (cashAgree === true) status = "MATCH";
      else status = "PARTIAL";
      rows.push({
        code,
        exDate,
        status,
        sources,
        cashBySource,
        recordBySource,
        planBySource,
        cashAgree,
        recordAgree,
      });
    }
  }
  return rows;
}

export function reconcileGoldenSample(): ReconcileRow[] {
  const events = goldenDividends();
  return reconcileDividendSources(
    {
      eastmoney: events.map((event) => goldenToAccuracy(event, "eastmoney")),
      cninfo: events.map((event) => goldenToAccuracy(event, "cninfo")),
      sina: events.map((event) => goldenToAccuracy(event, "sina")),
    },
    GOLDEN_CODES,
    3,
  );
}

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function reconcileToCsv(rows: readonly ReconcileRow[]): string {
  const header = [
    "code",
    "ex_date",
    "status",
    "sources",
    "cash_agree",
    "record_agree",
    "cash_per_10_eastmoney",
    "cash_per_10_sina",
    "cash_per_10_cninfo",
    "record_eastmoney",
    "record_sina",
    "record_cninfo",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.code,
        row.exDate,
        row.status,
        row.sources.join(","),
        row.cashAgree,
        row.recordAgree,
        row.cashBySource.eastmoney,
        row.cashBySource.sina,
        row.cashBySource.cninfo,
        row.recordBySource.eastmoney,
        row.recordBySource.sina,
        row.recordBySource.cninfo,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function breaksToCsv(rows: readonly ReconcileRow[]): string {
  return reconcileToCsv(rows.filter((row) => row.status !== "MATCH"));
}

export function scanMissedEvents(
  source: readonly MissedEventRef[],
  stored: readonly MissedEventRef[],
): MissedEventRef[] {
  const have = new Set(stored.map((row) => `${row.code}|${row.ex_dividend_date}`));
  const seen = new Set<string>();
  const missing: MissedEventRef[] = [];
  for (const row of source) {
    const key = `${row.code}|${row.ex_dividend_date}`;
    if (!row.code || !row.ex_dividend_date || seen.has(key)) continue;
    seen.add(key);
    if (!have.has(key)) missing.push({ code: row.code, ex_dividend_date: row.ex_dividend_date });
  }
  return missing;
}

export function pairCninfo(
  eastmoney: AccuracyEvent,
  cninfoEvents: readonly AccuracyEvent[],
): AccuracyEvent | null {
  const byEx = cninfoEvents.find(
    (event) => event.code === eastmoney.code && event.exDate === eastmoney.exDate,
  );
  if (byEx) return byEx;
  if (!eastmoney.recordDate) return null;
  const byRecord = cninfoEvents.filter(
    (event) => event.code === eastmoney.code && event.recordDate === eastmoney.recordDate,
  );
  return byRecord.length === 1 ? (byRecord[0] ?? null) : null;
}

/**
 * Cninfo wins cash when it disagrees beyond 0.001 (or Eastmoney cash is missing),
 * and wins pay/ex dates when it has a different value. Both raw texts are kept.
 * Sina is not an override source.
 */
export function applyCninfoPriority(
  code: string,
  eastmoney: SourcePrioritySide,
  cninfo: SourcePrioritySide | null,
): SourcePriorityDecision {
  const overridden: string[] = [];
  let cash = eastmoney.cashPer10;
  let cashSource: "eastmoney" | "cninfo" = "eastmoney";
  let exDate = eastmoney.exDate;
  let exSource: "eastmoney" | "cninfo" = "eastmoney";
  let payDate = eastmoney.payDate;
  let paySource: "eastmoney" | "cninfo" | "none" = eastmoney.payDate ? "eastmoney" : "none";
  let profile = eastmoney.planText;
  if (cninfo) {
    if (cninfo.cashPer10 != null && (cash == null || !cashPer10Close(cash, cninfo.cashPer10))) {
      cash = cninfo.cashPer10;
      cashSource = "cninfo";
      overridden.push("cash_div_pretax_per_10");
      if (cninfo.planText) profile = cninfo.planText;
    }
    if (cninfo.exDate && cninfo.exDate !== eastmoney.exDate) {
      exDate = cninfo.exDate;
      exSource = "cninfo";
      overridden.push("ex_dividend_date");
    }
    if (cninfo.payDate && cninfo.payDate !== eastmoney.payDate) {
      payDate = cninfo.payDate;
      paySource = "cninfo";
      overridden.push("pay_cash_date");
    }
  }
  return {
    code,
    exDividendDate: exDate,
    equityRecordDate: eastmoney.recordDate,
    payCashDate: payDate,
    cashDivPretaxPer10: cash,
    implPlanProfile: profile,
    cashSource,
    exSource,
    paySource,
    overridden,
    locateExDate: eastmoney.exDate,
    audit: {
      cash_div_pretax_per_10_em: eastmoney.cashPer10,
      cash_div_pretax_per_10_cninfo: cninfo?.cashPer10 ?? null,
      ex_dividend_date_em: eastmoney.exDate,
      ex_dividend_date_cninfo: cninfo?.exDate ?? null,
      pay_cash_date_em: eastmoney.payDate,
      pay_cash_date_cninfo: cninfo?.payDate ?? null,
      impl_plan_profile_em: eastmoney.planText,
      impl_plan_profile_cninfo: cninfo?.planText ?? null,
    },
  };
}

export function compareGoldenSample(
  events: readonly {
    code: string;
    exDividendDate: string;
    equityRecordDate: string | null;
    cashPer10: string | null;
  }[],
): { compared: number; matched: number; passRate: number | null } {
  const byKey = new Map(
    goldenDividends().map((event) => [`${event.code}|${event.ex_dividend_date}`, event]),
  );
  const seen = new Set<string>();
  let compared = 0;
  let matched = 0;
  for (const event of events) {
    const key = `${event.code}|${event.exDividendDate}`;
    const expected = byKey.get(key);
    if (!expected || seen.has(key)) continue;
    seen.add(key);
    compared += 1;
    const cash = event.cashPer10 == null || event.cashPer10 === "" ? null : Number(event.cashPer10);
    const cashOk =
      cash != null &&
      Number.isFinite(cash) &&
      cashPer10Close(cash, expected.cash_div_pretax_per_10);
    const recordOk = event.equityRecordDate === expected.equity_record_date;
    if (cashOk && recordOk) matched += 1;
  }
  return { compared, matched, passRate: compared === 0 ? null : matched / compared };
}

export function goldenEastmoneyRaw(event: GoldenEvent): Record<string, unknown> {
  return {
    SECURITY_CODE: event.code,
    SECUCODE: event.secucode,
    SECURITY_NAME_ABBR: event.name,
    PRETAX_BONUS_RMB: event.sources.eastmoney.cash_div_pretax_per_10,
    BONUS_RATIO: null,
    IT_RATIO: null,
    EQUITY_RECORD_DATE: `${event.equity_record_date} 00:00:00`,
    EX_DIVIDEND_DATE: `${event.ex_dividend_date} 00:00:00`,
    ASSIGN_PROGRESS: event.assign_progress,
    IMPL_PLAN_PROFILE: event.impl_plan_profile,
  };
}
