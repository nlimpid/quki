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

/** A pending claim older than this may be retried. Not a database lock timeout. */
export const APPLY_LEASE_MS = 60_000;

export type ApplyClaim = "claimed" | "replay" | "conflict" | "in_progress";

export type HoldingsStore = {
  list(userId: string): Promise<HoldingLine[]>;
  replaceAll(userId: string, lines: readonly HoldingLine[], now: Date): Promise<void>;
  setExact(userId: string, lines: readonly HoldingLine[], now: Date): Promise<void>;
  /**
   * Inserts the pending claim before any holdings write. One primary key, one statement.
   * The loser of that insert does not write. This is not a multi-statement transaction.
   */
  claimApply(userId: string, key: string, hash: string, now: Date): Promise<ApplyClaim>;
  /** Marks the claim applied only after the holdings write returned. False is not success. */
  completeApply(userId: string, key: string, hash: string): Promise<boolean>;
  /**
   * Reserves one vision attempt before the provider call. Failed attempts stay counted
   * until the window expires. Over-limit reservations are released and do not proceed.
   */
  reserveAttempt(
    userId: string,
    now: Date,
    limit: number,
    windowMs: number,
  ): Promise<{ id: string } | "limited">;
  finishAttempt(userId: string, id: string, status: "finished" | "failed"): Promise<void>;
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
  ): Promise<{ payloadJson: string; consumed: boolean } | "missing" | "expired">;
  consumeDraft(
    userId: string,
    id: string,
    now: Date,
  ): Promise<{ payloadJson: string } | "missing" | "lost" | "expired">;
};

function sharesOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 1 && String(parsed) === value) return parsed;
  }
  return null;
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
    async claimApply(userId, key, hash, now) {
      const stamp = formatSqlDateTime(now);
      try {
        await db().execute(
          "INSERT INTO auth_holding_applies (user_id, idempotency_key, payload_hash, status, claimed_at, created_at) VALUES (?, ?, ?, 'pending', ?, ?)",
          [userId, key, hash, stamp, stamp],
        );
        return "claimed";
      } catch (error) {
        const result = await db().execute(
          "SELECT payload_hash, status, claimed_at FROM auth_holding_applies WHERE user_id = ? AND idempotency_key = ? LIMIT 1",
          [userId, key],
        );
        const row = rowsOf(result)[0];
        if (!row || row.payload_hash !== hash) {
          void error;
          return "conflict";
        }
        if (row.status === "applied") return "replay";
        const claimedAt = parseSqlDateTime(row.claimed_at);
        if (!claimedAt || now.getTime() - claimedAt.getTime() < APPLY_LEASE_MS)
          return "in_progress";
        const updated = await db().execute(
          "UPDATE auth_holding_applies SET claimed_at = ? WHERE user_id = ? AND idempotency_key = ? AND payload_hash = ? AND status = 'pending' AND claimed_at = ?",
          [stamp, userId, key, hash, formatSqlDateTime(claimedAt)],
        );
        return rowsAffectedOf(updated) === 1 ? "claimed" : "in_progress";
      }
    },
    async completeApply(userId, key, hash) {
      const updated = await db().execute(
        "UPDATE auth_holding_applies SET status = 'applied' WHERE user_id = ? AND idempotency_key = ? AND payload_hash = ? AND status = 'pending'",
        [userId, key, hash],
      );
      return rowsAffectedOf(updated) === 1;
    },
    async reserveAttempt(userId, now, limit, windowMs) {
      const id = crypto.randomUUID();
      const since = new Date(now.getTime() - windowMs);
      await db().execute(
        "INSERT INTO auth_import_attempts (id, user_id, status, created_at) VALUES (?, ?, 'reserved', ?)",
        [id, userId, formatSqlDateTime(now)],
      );
      const counted = await db().execute(
        "SELECT COUNT(*) AS attempt_count FROM auth_import_attempts WHERE user_id = ? AND created_at > ? AND status <> 'released'",
        [userId, formatSqlDateTime(since)],
      );
      const value = rowsOf(counted)[0]?.attempt_count;
      const parsed = typeof value === "number" ? value : Number(value);
      if (!Number.isInteger(parsed) || parsed > limit) {
        await db().execute(
          "UPDATE auth_import_attempts SET status = 'released' WHERE id = ? AND user_id = ? AND status = 'reserved'",
          [id, userId],
        );
        return "limited";
      }
      return { id };
    },
    async finishAttempt(userId, id, status) {
      await db().execute(
        "UPDATE auth_import_attempts SET status = ? WHERE id = ? AND user_id = ? AND status = 'reserved'",
        [status, id, userId],
      );
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
      const expires = parseSqlDateTime(row.expires_at);
      if (row.consumed_at == null && (!expires || expires.getTime() <= now.getTime()))
        return "expired";
      return { payloadJson: row.payload_json, consumed: row.consumed_at != null };
    },
    async consumeDraft(userId, id, now) {
      const updated = await db().execute(
        "UPDATE auth_import_drafts SET consumed_at = ? WHERE id = ? AND user_id = ? AND consumed_at IS NULL AND expires_at > ?",
        [formatSqlDateTime(now), id, userId, formatSqlDateTime(now)],
      );
      if (rowsAffectedOf(updated) !== 1) {
        const existing = await db().execute(
          "SELECT consumed_at, expires_at FROM auth_import_drafts WHERE id = ? AND user_id = ? LIMIT 1",
          [id, userId],
        );
        const row = rowsOf(existing)[0];
        if (!row) return "missing";
        if (row.consumed_at == null) return "expired";
        return "lost";
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
