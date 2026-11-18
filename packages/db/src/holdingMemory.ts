import type { SqlConn } from "./client.js";
import { createAuthMemoryConn } from "./authMemory.js";

/**
 * In-process stand-in for auth_holdings and the listed-company lookup.
 * Tests only. Not used by the worker, and not a TiDB session.
 * Statements run to completion on one thread. Promise.all still observes
 * duplicate keys because the insert finishes before the next statement starts.
 */

type HoldingRow = {
  userId: string;
  code: string;
  shares: number;
  version: string;
  updatedAt: string;
};

export function createCandidateHoldingMemoryConn(listedCodes: readonly string[]): SqlConn {
  const auth = createAuthMemoryConn();
  const listed = new Set(listedCodes);
  const rows: HoldingRow[] = [];

  return {
    async execute(sql: string, params: unknown[] = []) {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text.startsWith("SELECT code FROM companies ")) {
        const code = String(params[0] ?? "");
        return { rows: listed.has(code) ? [{ code }] : [] };
      }
      if (text.startsWith("SELECT code, shares, version, updated_at FROM auth_holdings ")) {
        const userId = String(params[0] ?? "");
        return {
          rows: rows
            .filter((row) => row.userId === userId)
            .sort((left, right) => left.code.localeCompare(right.code))
            .map((row) => ({
              code: row.code,
              shares: row.shares,
              version: row.version,
              updated_at: row.updatedAt,
            })),
        };
      }
      if (text.startsWith("INSERT INTO auth_holdings ")) {
        const [userId, code, shares, version, updatedAt] = params;
        const next = {
          userId: String(userId),
          code: String(code),
          shares: Number(shares),
          version: String(version),
          updatedAt: String(updatedAt),
        };
        if (rows.some((row) => row.userId === next.userId && row.code === next.code)) {
          throw new Error("Duplicate entry 'auth_holdings'");
        }
        rows.push(next);
        return { rows: [], rowsAffected: 1 };
      }
      if (text.startsWith("UPDATE auth_holdings ")) {
        const [shares, version, updatedAt, userId, code, expectedVersion] = params;
        const row = rows.find(
          (item) => item.userId === String(userId) && item.code === String(code),
        );
        if (!row || row.version !== String(expectedVersion)) return { rows: [], rowsAffected: 0 };
        row.shares = Number(shares);
        row.version = String(version);
        row.updatedAt = String(updatedAt);
        return { rows: [], rowsAffected: 1 };
      }
      if (text.startsWith("DELETE FROM auth_holdings ")) {
        const [userId, code, expectedVersion] = params;
        const index = rows.findIndex(
          (item) =>
            item.userId === String(userId) &&
            item.code === String(code) &&
            item.version === String(expectedVersion),
        );
        if (index < 0) return { rows: [], rowsAffected: 0 };
        rows.splice(index, 1);
        return { rows: [], rowsAffected: 1 };
      }
      return auth.execute(sql, params);
    },
  };
}
