import { rowsOf, type SqlConn } from "./client.js";
import { formatSqlDateTime, parseSqlDateTime, rowsAffectedOf } from "./auth.js";

export type HoldingLine = {
  code: string;
  shares: number;
  updatedAt: string;
};

export type HoldingCashQuote = {
  code: string;
  name: string;
  ttmCashPerShare: string | null;
  yieldAsOf: string | null;
};

export type HoldingsStore = {
  list(userId: string): Promise<HoldingLine[]>;
  replaceAll(userId: string, lines: readonly HoldingLine[], now: Date): Promise<void>;
  setExact(userId: string, lines: readonly HoldingLine[], now: Date): Promise<void>;
  findApply(userId: string, key: string): Promise<{ hash: string } | null>;
  insertApply(userId: string, key: string, hash: string, now: Date): Promise<boolean>;
  countDraftsSince(userId: string, since: Date): Promise<number>;
  insertDraft(input: {
    id: string;
    userId: string;
    payloadJson: string;
    expiresAt: Date;
    now: Date;
  }): Promise<void>;
  readDraft(
    userId: string,
    id: string,
    now: Date,
  ): Promise<{ payloadJson: string } | "missing" | "expired" | "consumed">;
  consumeDraft(
    userId: string,
    id: string,
    now: Date,
  ): Promise<{ payloadJson: string } | "missing" | "lost">;
};

function sharesOf(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

export function createHoldingsStore(getConn: () => SqlConn): HoldingsStore {
  let conn: SqlConn | null = null;
  const db = () => (conn ??= getConn());
  return {
    async list(userId) {
      const result = await db().execute(
        "SELECT code, shares, updated_at FROM auth_holdings WHERE user_id = ? ORDER BY code",
        [userId],
      );
      const lines: HoldingLine[] = [];
      for (const row of rowsOf(result)) {
        const code = typeof row.code === "string" ? row.code : "";
        const shares = sharesOf(row.shares);
        const updated = parseSqlDateTime(row.updated_at);
        if (!/^\d{6}$/.test(code) || shares == null || !updated) continue;
        lines.push({ code, shares, updatedAt: updated.toISOString() });
      }
      return lines;
    },
    async replaceAll(userId, lines, now) {
      if (lines.length === 0) {
        await db().execute("DELETE FROM auth_holdings WHERE user_id = ?", [userId]);
        return;
      }
      const marks = lines.map(() => "?").join(", ");
      await db().execute(`DELETE FROM auth_holdings WHERE user_id = ? AND code NOT IN (${marks})`, [
        userId,
        ...lines.map((line) => line.code),
      ]);
      await upsertLines(db, userId, lines, now);
    },
    async setExact(userId, lines, now) {
      await upsertLines(db, userId, lines, now);
    },
    async findApply(userId, key) {
      const result = await db().execute(
        "SELECT payload_hash FROM auth_holding_applies WHERE user_id = ? AND idempotency_key = ? LIMIT 1",
        [userId, key],
      );
      const row = rowsOf(result)[0];
      const hash = row && typeof row.payload_hash === "string" ? row.payload_hash : null;
      return hash ? { hash } : null;
    },
    async insertApply(userId, key, hash, now) {
      try {
        await db().execute(
          "INSERT INTO auth_holding_applies (user_id, idempotency_key, payload_hash, created_at) VALUES (?, ?, ?, ?)",
          [userId, key, hash, formatSqlDateTime(now)],
        );
        return true;
      } catch {
        return false;
      }
    },
    async countDraftsSince(userId, since) {
      const result = await db().execute(
        "SELECT COUNT(*) AS draft_count FROM auth_import_drafts WHERE user_id = ? AND created_at > ?",
        [userId, formatSqlDateTime(since)],
      );
      const value = rowsOf(result)[0]?.draft_count;
      const parsed = typeof value === "number" ? value : Number(value);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    },
    async insertDraft(input) {
      await db().execute(
        "INSERT INTO auth_import_drafts (id, user_id, payload_json, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
        [
          input.id,
          input.userId,
          input.payloadJson,
          formatSqlDateTime(input.expiresAt),
          formatSqlDateTime(input.now),
        ],
      );
    },
    async readDraft(userId, id, now) {
      const result = await db().execute(
        "SELECT payload_json, expires_at, consumed_at FROM auth_import_drafts WHERE id = ? AND user_id = ? LIMIT 1",
        [id, userId],
      );
      const row = rowsOf(result)[0];
      if (!row || typeof row.payload_json !== "string") return "missing";
      if (row.consumed_at != null) return "consumed";
      const expires = parseSqlDateTime(row.expires_at);
      if (!expires || expires.getTime() <= now.getTime()) return "expired";
      return { payloadJson: row.payload_json };
    },
    async consumeDraft(userId, id, now) {
      const updated = await db().execute(
        "UPDATE auth_import_drafts SET consumed_at = ? WHERE id = ? AND user_id = ? AND consumed_at IS NULL AND expires_at > ?",
        [formatSqlDateTime(now), id, userId, formatSqlDateTime(now)],
      );
      if (rowsAffectedOf(updated) !== 1) {
        const existing = await db().execute(
          "SELECT id FROM auth_import_drafts WHERE id = ? AND user_id = ? LIMIT 1",
          [id, userId],
        );
        return rowsOf(existing).length === 0 ? "missing" : "lost";
      }
      const result = await db().execute(
        "SELECT payload_json FROM auth_import_drafts WHERE id = ? AND user_id = ? LIMIT 1",
        [id, userId],
      );
      const payload = rowsOf(result)[0]?.payload_json;
      if (typeof payload !== "string") return "lost";
      return { payloadJson: payload };
    },
  };
}

async function upsertLines(
  db: () => SqlConn,
  userId: string,
  lines: readonly HoldingLine[],
  now: Date,
): Promise<void> {
  const stamp = formatSqlDateTime(now);
  for (const line of lines) {
    await db().execute(
      "INSERT INTO auth_holdings (user_id, code, shares, updated_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE shares = VALUES(shares), updated_at = VALUES(updated_at)",
      [userId, line.code, line.shares, stamp],
    );
  }
}

export async function lookupHoldingCash(
  conn: SqlConn,
  codes: readonly string[],
): Promise<HoldingCashQuote[]> {
  const unique = [...new Set(codes)].filter((code) => /^\d{6}$/.test(code));
  if (unique.length === 0) return [];
  const marks = unique.map(() => "?").join(", ");
  const result = await conn.execute(
    `SELECT code, name, CAST(ttm_cash_per_share AS CHAR) AS ttm_cash, DATE_FORMAT(yield_as_of, '%Y-%m-%d') AS yield_as_of FROM companies WHERE listing_status = 'listed' AND code IN (${marks})`,
    [...unique],
  );
  const quotes: HoldingCashQuote[] = [];
  for (const row of rowsOf(result)) {
    const code = typeof row.code === "string" ? row.code : "";
    const name = typeof row.name === "string" ? row.name : "";
    if (!/^\d{6}$/.test(code) || name.length === 0) continue;
    quotes.push({
      code,
      name,
      ttmCashPerShare:
        typeof row.ttm_cash === "string" && row.ttm_cash !== "NULL" ? row.ttm_cash : null,
      yieldAsOf: typeof row.yield_as_of === "string" ? row.yield_as_of : null,
    });
  }
  return quotes;
}
