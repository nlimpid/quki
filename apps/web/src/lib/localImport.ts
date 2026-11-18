export type LocalImportWrite = {
  code: string;
  shares: number;
  expectedVersion: string | null;
};

const SHARES_MAX = 1_000_000_000;

/** Rows that can be saved. Null while the account list is still loading. Nothing is sent here. */
export function planLocalImport(
  localRows: readonly { code: string; shares: number }[],
  accountRows: readonly { code: string; version: string }[] | null,
): LocalImportWrite[] | null {
  if (accountRows == null) return null;
  const versions = new Map(accountRows.map((row) => [row.code, row.version]));
  const writes: LocalImportWrite[] = [];
  for (const row of localRows) {
    if (!/^\d{6}$/.test(row.code)) continue;
    if (!Number.isSafeInteger(row.shares) || row.shares < 1 || row.shares > SHARES_MAX) continue;
    writes.push({
      code: row.code,
      shares: row.shares,
      expectedVersion: versions.get(row.code) ?? null,
    });
  }
  return writes;
}
