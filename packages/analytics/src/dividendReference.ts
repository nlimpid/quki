import { validShareCount } from "./holdings.js";

/** 1 CNY = 100_000_000 minor units, matching DECIMAL(18,8) per-share cash. */
const MINOR_SCALE = 100_000_000n;
const MAX_PER_SHARE_MINOR = 1_000_000n * MINOR_SCALE;

export const DIVIDEND_REFERENCE_LABEL =
  "近12个自然月已实施的税前每股现金 × 股数。这是截至行情日期的历史参考，不是未来分红预测，也不含尚未实施的预案。";

export const IMAGE_PROCESS_CONSENT = "third-party-image-processing";

export const IMAGE_PROCESS_DISCLOSURE =
  "识图会把截图送到尚未选定的第三方视觉服务处理。本站不保存原图，也不把识别文字当作指令。在你明确同意并且服务已经配置之前，图片不会离开浏览器。";

export type CashCoverage = {
  code: string;
  name: string | null;
  shares: number;
  /** Exact decimal text from the database. A JavaScript number is not accepted. */
  ttmCashPerShare: string | null;
  yieldAsOf: string | null;
};

export type DividendReferenceLine = {
  code: string;
  name: string | null;
  shares: number;
  ttmCashPerShare: string | null;
  yieldAsOf: string | null;
  cashCny: string | null;
  coverage: "covered" | "missing";
};

export type DividendReference = {
  kind: "trailing_12_month_implemented_cash";
  label: string;
  pretax: true;
  guaranteed: false;
  includesUnimplementedPlans: false;
  asOf: string | null;
  datesDiffer: boolean;
  heldCount: number;
  coveredCount: number;
  missingCount: number;
  totalCashCny: string | null;
  partial: boolean;
  lines: DividendReferenceLine[];
};

const CASH_RE = /^\d{1,12}(\.\d{1,8})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseCashPerShare(value: string): bigint | null {
  if (!CASH_RE.test(value)) return null;
  const [whole = "", frac = ""] = value.split(".");
  const minor = BigInt(whole) * MINOR_SCALE + BigInt(frac.padEnd(8, "0"));
  if (minor > MAX_PER_SHARE_MINOR) return null;
  return minor;
}

export function formatCashMinor(minor: bigint): string {
  const whole = minor / MINOR_SCALE;
  const frac = (minor % MINOR_SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  return frac.length > 0 ? `${whole.toString()}.${frac}` : whole.toString();
}

export function multiplyCashByShares(perShareMinor: bigint, shares: number): bigint | null {
  const count = validShareCount(shares);
  if (count == null) return null;
  return perShareMinor * BigInt(count);
}

export function buildDividendReference(rows: readonly CashCoverage[]): DividendReference {
  const seen = new Set<string>();
  const lines: DividendReferenceLine[] = [];
  let total = 0n;
  let coveredCount = 0;
  let asOf: string | null = null;
  let datesDiffer = false;
  for (const row of rows) {
    if (!/^\d{6}$/.test(row.code) || seen.has(row.code) || validShareCount(row.shares) == null) {
      throw new Error("holding_line");
    }
    seen.add(row.code);
    const cashText = row.ttmCashPerShare;
    const dated = row.yieldAsOf != null && DATE_RE.test(row.yieldAsOf) ? row.yieldAsOf : null;
    if (cashText == null || dated == null) {
      lines.push({
        code: row.code,
        name: row.name,
        shares: row.shares,
        ttmCashPerShare: null,
        yieldAsOf: dated,
        cashCny: null,
        coverage: "missing",
      });
      continue;
    }
    const perShare = parseCashPerShare(cashText);
    if (perShare == null) {
      lines.push({
        code: row.code,
        name: row.name,
        shares: row.shares,
        ttmCashPerShare: null,
        yieldAsOf: dated,
        cashCny: null,
        coverage: "missing",
      });
      continue;
    }
    const cash = multiplyCashByShares(perShare, row.shares);
    if (cash == null) {
      lines.push({
        code: row.code,
        name: row.name,
        shares: row.shares,
        ttmCashPerShare: null,
        yieldAsOf: dated,
        cashCny: null,
        coverage: "missing",
      });
      continue;
    }
    coveredCount += 1;
    total += cash;
    if (asOf == null) asOf = dated;
    else if (asOf !== dated) datesDiffer = true;
    lines.push({
      code: row.code,
      name: row.name,
      shares: row.shares,
      ttmCashPerShare: formatCashMinor(perShare),
      yieldAsOf: dated,
      cashCny: formatCashMinor(cash),
      coverage: "covered",
    });
  }
  if (datesDiffer) {
    const dates = lines.flatMap((line) => (line.yieldAsOf ? [line.yieldAsOf] : []));
    asOf =
      dates.length === 0
        ? null
        : dates.reduce((earliest, date) => (date < earliest ? date : earliest));
  }
  const missingCount = lines.length - coveredCount;
  return {
    kind: "trailing_12_month_implemented_cash",
    label: DIVIDEND_REFERENCE_LABEL,
    pretax: true,
    guaranteed: false,
    includesUnimplementedPlans: false,
    asOf: coveredCount === 0 ? null : asOf,
    datesDiffer,
    heldCount: lines.length,
    coveredCount,
    missingCount,
    totalCashCny: coveredCount === 0 ? null : formatCashMinor(total),
    partial: missingCount > 0,
    lines,
  };
}

export function dividendReferenceNote(reference: DividendReference): string {
  const parts = [reference.label, "税前，不是收益承诺。"];
  if (reference.coveredCount === 0) {
    parts.push("目前没有可计入的已实施现金，因此没有合计。");
  } else if (reference.partial) {
    parts.push(
      `合计只含有数据的 ${reference.coveredCount} 只，另有 ${reference.missingCount} 只未计入。`,
    );
  }
  if (reference.datesDiffer) parts.push("各股统计日期不完全相同，显示的日期是其中较早的一天。");
  return parts.join("");
}
