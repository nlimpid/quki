import { connect } from "@tidbcloud/serverless";

export const DATABASE_URL_ENV = "TIDB_QUKI_DATABASE_URL";

export type SqlConn = {
  execute: (sql: string, params?: unknown[]) => Promise<unknown>;
};

export function connectTiDb(url = process.env[DATABASE_URL_ENV]): SqlConn {
  if (!url) {
    throw new Error(
      `Missing ${DATABASE_URL_ENV}. Set it in the environment or .dev.vars (see .dev.vars.example).`,
    );
  }
  // Without fullResult the driver returns a bare row array. Callers that only
  // look at `{ rows }` then see every query as empty.
  return connect({ url, fullResult: true }) as SqlConn;
}

export function rowsOf(result: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(result)
    ? result
    : result && typeof result === "object" && "rows" in result
      ? (result as { rows?: unknown }).rows
      : undefined;
  if (!Array.isArray(rows)) return [];
  return rows.filter(
    (row): row is Record<string, unknown> =>
      !!row && typeof row === "object" && !Array.isArray(row),
  );
}

export function dateText(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function numOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
