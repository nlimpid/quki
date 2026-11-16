import type { SqlConn } from "./client.js";

/** In-process stand-in for the auth tables. Tests only. Not used by the worker. */

type UserRow = { id: string; issuer: string; subject: string; displayName: string | null };
type SessionRow = {
  id: string;
  userId: string;
  tokenHash: string;
  csrfToken: string;
  expiresAt: string;
  revokedAt: string | null;
};
type TxnRow = {
  id: string;
  tokenHash: string;
  state: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  expiresAt: string;
};

export type AuthQuery = { sql: string; params: readonly unknown[] };

export function createAuthMemoryConn(): SqlConn & { queries: AuthQuery[] } {
  const users: UserRow[] = [];
  const sessions: SessionRow[] = [];
  const txns: TxnRow[] = [];
  const queries: AuthQuery[] = [];

  return {
    queries,
    async execute(sql: string, params: unknown[] = []) {
      queries.push({ sql, params: [...params] });
      const text = sql.replace(/\s+/g, " ").trim();
      if (/^INSERT INTO auth_users /i.test(text)) {
        const [id, issuer, subject, displayName] = params;
        if (users.some((user) => user.issuer === issuer && user.subject === subject)) {
          throw new Error("duplicate identity");
        }
        users.push({
          id: String(id),
          issuer: String(issuer),
          subject: String(subject),
          displayName: displayName == null ? null : String(displayName),
        });
        return { rows: [] };
      }
      if (/^SELECT id, display_name FROM auth_users /i.test(text)) {
        const [issuer, subject] = params;
        const user = users.find((row) => row.issuer === issuer && row.subject === subject);
        return { rows: user ? [{ id: user.id, display_name: user.displayName }] : [] };
      }
      if (/^UPDATE auth_users SET display_name/i.test(text)) {
        const [displayName, id] = params;
        const user = users.find((row) => row.id === id);
        if (user) user.displayName = displayName == null ? null : String(displayName);
        return { rows: [] };
      }
      if (/^INSERT INTO auth_sessions /i.test(text)) {
        const [id, userId, tokenHash, csrfToken, expiresAt] = params;
        sessions.push({
          id: String(id),
          userId: String(userId),
          tokenHash: String(tokenHash),
          csrfToken: String(csrfToken),
          expiresAt: String(expiresAt),
          revokedAt: null,
        });
        return { rows: [] };
      }
      if (/^SELECT s\.id AS session_id/i.test(text)) {
        const [tokenHash] = params;
        const session = sessions.find((row) => row.tokenHash === tokenHash);
        const user = users.find((row) => row.id === session?.userId);
        if (!session || !user) return { rows: [] };
        return {
          rows: [
            {
              session_id: session.id,
              expires_at: session.expiresAt,
              revoked_at: session.revokedAt,
              csrf_token: session.csrfToken,
              user_id: user.id,
              display_name: user.displayName,
            },
          ],
        };
      }
      if (/^UPDATE auth_sessions SET revoked_at/i.test(text)) {
        const [revokedAt, id] = params;
        const session = sessions.find((row) => row.id === id && row.revokedAt == null);
        if (session) session.revokedAt = String(revokedAt);
        return { rows: [] };
      }
      if (/^INSERT INTO auth_oauth_transactions /i.test(text)) {
        const [id, tokenHash, state, codeVerifier, nonce, returnTo, expiresAt] = params;
        txns.push({
          id: String(id),
          tokenHash: String(tokenHash),
          state: String(state),
          codeVerifier: String(codeVerifier),
          nonce: String(nonce),
          returnTo: String(returnTo),
          expiresAt: String(expiresAt),
        });
        return { rows: [] };
      }
      if (/^SELECT id, state_secret/i.test(text)) {
        const [tokenHash] = params;
        const txn = txns.find((row) => row.tokenHash === tokenHash);
        return {
          rows: txn
            ? [
                {
                  id: txn.id,
                  state_secret: txn.state,
                  code_verifier: txn.codeVerifier,
                  nonce: txn.nonce,
                  return_to: txn.returnTo,
                  expires_at: txn.expiresAt,
                },
              ]
            : [],
        };
      }
      if (/^DELETE FROM auth_oauth_transactions /i.test(text)) {
        const [tokenHash, state, expiresAfter] = params;
        const index = txns.findIndex(
          (row) =>
            row.tokenHash === tokenHash &&
            row.state === state &&
            row.expiresAt > String(expiresAfter),
        );
        if (index < 0) return { rows: [], rowsAffected: 0 };
        txns.splice(index, 1);
        return { rows: [], rowsAffected: 1 };
      }
      throw new Error(`unexpected auth sql: ${text}`);
    },
  };
}
