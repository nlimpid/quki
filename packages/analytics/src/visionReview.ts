import { validShareCount } from "./holdings.js";

/** Text returned by an image model. It is data, never a tool call. */
export type VisionRow = {
  code: string | null;
  name: string | null;
  totalShares: string | null;
  availableShares: string | null;
};

export type VisionFlag =
  | "ambiguous_shares"
  | "ignored_available_shares"
  | "duplicate_code"
  | "bad_code"
  | "name_mismatch"
  | "unknown_code"
  | "untrusted_text";

export type ReviewedVisionRow = {
  code: string | null;
  name: string | null;
  totalShares: number | null;
  flags: VisionFlag[];
};

export type ImportConfirmation = {
  code: string;
  shares: number;
  nameConfirmed: boolean;
  unknownConfirmed: boolean;
  sharesConfirmed: boolean;
};

const CODE_RE = /^\d{6}$/;

function parseTotalShares(value: string | null): number | null {
  if (value == null) return null;
  const stripped = value.replaceAll(",", "").replaceAll(" ", "");
  if (!/^[1-9]\d*$/.test(stripped)) return null;
  return validShareCount(Number(stripped));
}

export function reviewVisionRows(
  rows: readonly VisionRow[],
  catalog: ReadonlyMap<string, string>,
): ReviewedVisionRow[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const flags: VisionFlag[] = ["untrusted_text"];
    const code = typeof row.code === "string" && CODE_RE.test(row.code) ? row.code : null;
    if (code == null) flags.push("bad_code");
    if (row.availableShares != null && row.availableShares.trim() !== "") {
      flags.push("ignored_available_shares");
    }
    const totalShares = code == null ? null : parseTotalShares(row.totalShares);
    if (totalShares == null) flags.push("ambiguous_shares");
    if (code != null && seen.has(code)) {
      flags.push("duplicate_code");
    }
    if (code != null) seen.add(code);
    const official = code == null ? undefined : catalog.get(code);
    if (code != null && official == null) flags.push("unknown_code");
    if (code != null && official != null && row.name !== official) flags.push("name_mismatch");
    const duplicate = flags.includes("duplicate_code");
    return {
      code,
      name: typeof row.name === "string" ? row.name : null,
      totalShares: duplicate ? null : totalShares,
      flags,
    };
  });
}

export type LocalImportPlan = {
  changes: { code: string; shares: number; previousShares: number | null }[];
  /** Account codes absent from this import. They stay until a separate delete. */
  preserved: { code: string; shares: number }[];
};

export function localImportPlan(
  localItems: readonly { code: string; shares: number }[],
  serverItems: readonly { code: string; shares: number }[],
): LocalImportPlan {
  const seen = new Set<string>();
  const changes: LocalImportPlan["changes"] = [];
  for (const item of localItems) {
    if (!/^\d{6}$/.test(item.code) || seen.has(item.code) || validShareCount(item.shares) == null) {
      throw new Error("holding_line");
    }
    seen.add(item.code);
    const previous = serverItems.find((row) => row.code === item.code);
    changes.push({
      code: item.code,
      shares: item.shares,
      previousShares: previous?.shares ?? null,
    });
  }
  const preserved = serverItems.filter(
    (row) => /^\d{6}$/.test(row.code) && validShareCount(row.shares) != null && !seen.has(row.code),
  );
  return { changes, preserved };
}

export function visionFlagLabel(flag: VisionFlag): string {
  switch (flag) {
    case "ambiguous_shares":
      return "总股数无法确定，需要你填写";
    case "ignored_available_shares":
      return "已忽略可用股数，只采用总股数";
    case "duplicate_code":
      return "同一代码出现多次，不会自动相加";
    case "bad_code":
      return "代码不是 6 位数字";
    case "name_mismatch":
      return "名称与代码表不一致";
    case "unknown_code":
      return "代码表里没有这只代码";
    case "untrusted_text":
      return "识别文字只作核对，不会执行";
  }
}

export function confirmImportRows(
  draft: readonly ReviewedVisionRow[],
  submitted: readonly ImportConfirmation[],
  catalog: ReadonlyMap<string, string>,
): { ok: true; lines: { code: string; shares: number }[] } | { ok: false; error: string } {
  const seen = new Set<string>();
  const lines: { code: string; shares: number }[] = [];
  for (const row of submitted) {
    if (!CODE_RE.test(row.code) || seen.has(row.code))
      return { ok: false, error: "duplicate_or_bad_code" };
    seen.add(row.code);
    const drafted = draft.filter((item) => item.code === row.code);
    if (drafted.length === 0) return { ok: false, error: "not_in_preview" };
    const shares = validShareCount(row.shares);
    if (shares == null) return { ok: false, error: "bad_shares" };
    const official = catalog.get(row.code);
    if (official == null && !row.unknownConfirmed) return { ok: false, error: "unknown_code" };
    if (
      official != null &&
      drafted.some((item) => item.flags.includes("name_mismatch")) &&
      !row.nameConfirmed
    ) {
      return { ok: false, error: "name_mismatch" };
    }
    const parsed = drafted.some(
      (item) => item.totalShares === shares && !item.flags.includes("duplicate_code"),
    );
    if (!parsed && !row.sharesConfirmed) return { ok: false, error: "shares_unconfirmed" };
    lines.push({ code: row.code, shares });
  }
  return { ok: true, lines };
}
