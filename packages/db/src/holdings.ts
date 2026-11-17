import { rowsAffectedOf, formatSqlDateTime } from "./auth.js";
import { rowsOf, type SqlConn } from "./client.js";

/** Inclusive share count. The CHECK in 0008_auth_holdings.sql uses these same bounds. */
export const HOLDING_SHARES_MIN = 1;
export const HOLDING_SHARES_MAX = 1_000_000_000;

export const LISTED_COMPANY_SQL =
  "SELECT code FROM companies WHERE code = ? AND listing_status = 'listed' AND market IN ('SH', 'SZ') LIMIT 1";

export class HoldingTableMissing extends Error {
  constructor() {
    super("holdings_table_missing");
    this.name = "HoldingTableMissing";
  }
}

export type AccountHoldingRow = {
  code: string;
  shares: number;
  version: string;
  updatedAt: string;
};

export type HoldingWriteResult =
  | { ok: true; row: AccountHoldingRow }
  | { ok: false; reason: "conflict" | "unknown_code" | "invalid_shares" };

export type HoldingDeleteResult = { ok: true } | { ok: false; reason: "conflict" };

export type HoldingStore = {
  list(userId: string): Promise<AccountHoldingRow[]>;
  create(input: {
    userId: string;
    code: string;
    shares: number;
    now: Date;
  }): Promise<HoldingWriteResult>;
  update(input: {
    userId: string;
    code: string;
    shares: number;
    expectedVersion: string;
    now: Date;
  }): Promise<HoldingWriteResult>;
  remove(input: {
    userId: string;
    code: string;
    expectedVersion: string;
  }): Promise<HoldingDeleteResult>;
};

export function validHoldingShares(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= HOLDING_SHARES_MIN &&
    value <= HOLDING_SHARES_MAX
  );
}

/** 32 lowercase hex characters. A small integer is not a version. */
export function validHoldingVersion(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

export function newHoldingVersion(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function missingTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("holdings_table_missing") || message.includes("doesn't exist");
}

function duplicateRow(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("Duplicate entry") || message.includes("duplicate holding");
}

/**
 * Compare-and-swap for one (user, code) row.
 * A future OCR confirmation must call create or update. There is no second writer,
 * and this store has no image, draft, or quota.
 */
export function createHoldingStore(
  getConn: () => SqlConn,
  options: { newVersion?: () => string } = {},
): HoldingStore {
  let conn: SqlConn | null = null;
  const db = () => (conn ??= getConn());
  const nextVersion = options.newVersion ?? newHoldingVersion;

  async function listed(code: string): Promise<boolean> {
    const result = await db().execute(LISTED_COMPANY_SQL, [code]);
    return rowsOf(result).length === 1;
  }

  return {
    async list(userId) {
      try {
        const result = await db().execute(
          "SELECT code, shares, version, updated_at FROM auth_holdings WHERE user_id = ? ORDER BY code",
          [userId],
        );
        return rowsOf(result).map((row) => ({
          code: String(row.code),
          shares: Number(row.shares),
          version: String(row.version),
          updatedAt: String(row.updated_at),
        }));
      } catch (error) {
        if (missingTable(error)) throw new HoldingTableMissing();
        throw error;
      }
    },

    async create(input) {
      if (!validHoldingShares(input.shares)) return { ok: false, reason: "invalid_shares" };
      try {
        if (!(await listed(input.code))) return { ok: false, reason: "unknown_code" };
        const version = nextVersion();
        if (!validHoldingVersion(version)) throw new Error("version");
        const updatedAt = formatSqlDateTime(input.now);
        await db().execute(
          "INSERT INTO auth_holdings (user_id, code, shares, version, updated_at) VALUES (?, ?, ?, ?, ?)",
          [input.userId, input.code, input.shares, version, updatedAt],
        );
        return {
          ok: true,
          row: { code: input.code, shares: input.shares, version, updatedAt },
        };
      } catch (error) {
        if (duplicateRow(error)) return { ok: false, reason: "conflict" };
        if (missingTable(error)) throw new HoldingTableMissing();
        throw error;
      }
    },

    async update(input) {
      if (!validHoldingShares(input.shares)) return { ok: false, reason: "invalid_shares" };
      if (!validHoldingVersion(input.expectedVersion)) return { ok: false, reason: "conflict" };
      try {
        if (!(await listed(input.code))) return { ok: false, reason: "unknown_code" };
        const version = nextVersion();
        if (!validHoldingVersion(version) || version === input.expectedVersion) {
          throw new Error("version");
        }
        const updatedAt = formatSqlDateTime(input.now);
        const result = await db().execute(
          `UPDATE auth_holdings
           SET shares = ?, version = ?, updated_at = ?
           WHERE user_id = ? AND code = ? AND version = ?`,
          [input.shares, version, updatedAt, input.userId, input.code, input.expectedVersion],
        );
        if (rowsAffectedOf(result) !== 1) return { ok: false, reason: "conflict" };
        return { ok: true, row: { code: input.code, shares: input.shares, version, updatedAt } };
      } catch (error) {
        if (missingTable(error)) throw new HoldingTableMissing();
        throw error;
      }
    },

    async remove(input) {
      if (!validHoldingVersion(input.expectedVersion)) return { ok: false, reason: "conflict" };
      try {
        const result = await db().execute(
          "DELETE FROM auth_holdings WHERE user_id = ? AND code = ? AND version = ?",
          [input.userId, input.code, input.expectedVersion],
        );
        if (rowsAffectedOf(result) !== 1) return { ok: false, reason: "conflict" };
        return { ok: true };
      } catch (error) {
        if (missingTable(error)) throw new HoldingTableMissing();
        throw error;
      }
    },
  };
}
