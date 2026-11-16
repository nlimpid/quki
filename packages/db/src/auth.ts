import { rowsOf, type SqlConn } from "./client.js";

export type AuthUserRecord = {
  id: string;
  displayName: string | null;
};

export type SessionLookup =
  | { state: "missing" }
  | { state: "expired" | "revoked" }
  | {
      state: "valid";
      sessionId: string;
      csrfToken: string;
      expiresAt: Date;
      user: AuthUserRecord;
    };

export type TransactionRecord = {
  id: string;
  state: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  expiresAt: Date;
};

export type AuthStore = {
  findUser(provider: string, subject: string): Promise<AuthUserRecord | null>;
  insertUser(input: {
    id: string;
    provider: string;
    subject: string;
    displayName: string | null;
  }): Promise<void>;
  updateDisplayName(userId: string, displayName: string | null): Promise<void>;
  insertSession(input: {
    id: string;
    userId: string;
    tokenHash: string;
    csrfToken: string;
    expiresAt: Date;
  }): Promise<void>;
  findSession(tokenHash: string, now: Date): Promise<SessionLookup>;
  revokeSession(sessionId: string, now: Date): Promise<void>;
  insertTransaction(input: {
    id: string;
    tokenHash: string;
    state: string;
    codeVerifier: string;
    nonce: string;
    returnTo: string;
    expiresAt: Date;
  }): Promise<void>;
  /** Deletes the transaction. Returns it only when it was still unexpired. */
  takeTransaction(tokenHash: string, now: Date): Promise<TransactionRecord | null>;
};

export function formatSqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 23).replace("T", " ");
}

export function parseSqlDateTime(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" || value.trim().length < 10) return null;
  const iso = value.includes("T") ? value.trim() : value.trim().replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(iso) ? iso : `${iso}Z`;
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function sessionRecordState(
  expiresAt: Date | null,
  revokedAt: Date | null,
  now: Date,
): "valid" | "expired" | "revoked" {
  if (revokedAt) return "revoked";
  if (!expiresAt || expiresAt.getTime() <= now.getTime()) return "expired";
  return "valid";
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createAuthStore(getConn: () => SqlConn): AuthStore {
  let conn: SqlConn | null = null;
  const db = () => (conn ??= getConn());

  return {
    async findUser(provider, subject) {
      const result = await db().execute(
        "SELECT id, display_name FROM auth_users WHERE provider = ? AND provider_subject = ? LIMIT 1",
        [provider, subject],
      );
      const row = rowsOf(result)[0];
      const id = text(row?.id);
      if (!row || !id) return null;
      return { id, displayName: text(row.display_name) };
    },

    async insertUser(input) {
      await db().execute(
        "INSERT INTO auth_users (id, provider, provider_subject, display_name) VALUES (?, ?, ?, ?)",
        [input.id, input.provider, input.subject, input.displayName],
      );
    },

    async updateDisplayName(userId, displayName) {
      await db().execute("UPDATE auth_users SET display_name = ? WHERE id = ?", [
        displayName,
        userId,
      ]);
    },

    async insertSession(input) {
      await db().execute(
        "INSERT INTO auth_sessions (id, user_id, token_hash, csrf_token, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)",
        [
          input.id,
          input.userId,
          input.tokenHash,
          input.csrfToken,
          formatSqlDateTime(input.expiresAt),
        ],
      );
    },

    async findSession(tokenHash, now) {
      const result = await db().execute(
        `SELECT s.id AS session_id, s.expires_at, s.revoked_at, s.csrf_token,
                u.id AS user_id, u.display_name
         FROM auth_sessions s
         JOIN auth_users u ON u.id = s.user_id
         WHERE s.token_hash = ?
         LIMIT 1`,
        [tokenHash],
      );
      const row = rowsOf(result)[0];
      if (!row) return { state: "missing" };
      const sessionId = text(row.session_id);
      const userId = text(row.user_id);
      const csrfToken = text(row.csrf_token);
      if (!sessionId || !userId || !csrfToken) return { state: "expired" };
      const state = sessionRecordState(
        parseSqlDateTime(row.expires_at),
        parseSqlDateTime(row.revoked_at),
        now,
      );
      if (state !== "valid") return { state };
      const expiresAt = parseSqlDateTime(row.expires_at);
      if (!expiresAt) return { state: "expired" };
      return {
        state: "valid",
        sessionId,
        csrfToken,
        expiresAt,
        user: { id: userId, displayName: text(row.display_name) },
      };
    },

    async revokeSession(sessionId, now) {
      await db().execute(
        "UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
        [formatSqlDateTime(now), sessionId],
      );
    },

    async insertTransaction(input) {
      await db().execute(
        `INSERT INTO auth_oauth_transactions
           (id, token_hash, state_secret, code_verifier, nonce, return_to, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          input.id,
          input.tokenHash,
          input.state,
          input.codeVerifier,
          input.nonce,
          input.returnTo,
          formatSqlDateTime(input.expiresAt),
        ],
      );
    },

    async takeTransaction(tokenHash, now) {
      const result = await db().execute(
        `SELECT id, state_secret, code_verifier, nonce, return_to, expires_at
         FROM auth_oauth_transactions
         WHERE token_hash = ?
         LIMIT 1`,
        [tokenHash],
      );
      const row = rowsOf(result)[0];
      if (!row) return null;
      const id = text(row.id);
      if (id) {
        await db().execute("DELETE FROM auth_oauth_transactions WHERE id = ?", [id]);
      }
      const expiresAt = parseSqlDateTime(row.expires_at);
      const state = text(row.state_secret);
      const codeVerifier = text(row.code_verifier);
      const nonce = text(row.nonce);
      const returnTo = text(row.return_to);
      if (!id || !expiresAt || !state || !codeVerifier || !nonce || !returnTo) return null;
      if (expiresAt.getTime() <= now.getTime()) return null;
      return { id, state, codeVerifier, nonce, returnTo, expiresAt };
    },
  };
}
