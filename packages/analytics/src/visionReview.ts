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

export function localImportPlan(
  localItems: readonly { code: string; shares: number }[],
  serverItems: readonly { code: string; shares: number }[],
): { code: string; shares: number; previousShares: number | null }[] {
  const seen = new Set<string>();
  const plan: { code: string; shares: number; previousShares: number | null }[] = [];
  for (const item of localItems) {
    if (!/^\d{6}$/.test(item.code) || seen.has(item.code) || validShareCount(item.shares) == null) {
      throw new Error("holding_line");
    }
    seen.add(item.code);
    const previous = serverItems.find((row) => row.code === item.code);
    plan.push({ code: item.code, shares: item.shares, previousShares: previous?.shares ?? null });
  }
  return plan;
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
