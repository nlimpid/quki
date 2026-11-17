import { identityKey, rowsAffectedOf, formatSqlDateTime } from "./auth.js";
import { rowsOf, type SqlConn } from "./client.js";

export class IdentityTableMissing extends Error {
  constructor() {
    super("identity_table_missing");
    this.name = "IdentityTableMissing";
  }
}

export type IdentityStore = {
  /** Returns the existing UUID on a unique-key race. Never returns the losing insert id. */
  resolve(issuer: string, subject: string, now?: Date): Promise<string>;
};

function missingTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("identity_table_missing") || message.includes("doesn't exist");
}

function duplicateRow(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("Duplicate entry");
}

/**
 * Maps the verified iss and sub bytes to an internal UUID.
 * Email is not read and is not a column. Clerk's user id is the subject, not the UUID.
 */
export function createIdentityStore(getConn: () => SqlConn): IdentityStore {
  let conn: SqlConn | null = null;
  const db = () => (conn ??= getConn());

  async function find(issuer: Uint8Array, subject: Uint8Array): Promise<string | null> {
    const result = await db().execute(
      "SELECT id FROM auth_identities WHERE issuer = ? AND subject = ? LIMIT 1",
      [issuer, subject],
    );
    const id = rowsOf(result)[0]?.id;
    return typeof id === "string" && id.length > 0 ? id : null;
  }

  return {
    async resolve(issuer, subject, now = new Date()) {
      let issuerKey: Uint8Array;
      let subjectKey: Uint8Array;
      try {
        issuerKey = identityKey(issuer);
        subjectKey = identityKey(subject);
      } catch (error) {
        if (missingTable(error)) throw new IdentityTableMissing();
        throw error;
      }
      try {
        const existing = await find(issuerKey, subjectKey);
        if (existing) return existing;
        const created = crypto.randomUUID();
        try {
          const inserted = await db().execute(
            "INSERT INTO auth_identities (id, issuer, subject, created_at) VALUES (?, ?, ?, ?)",
            [created, issuerKey, subjectKey, formatSqlDateTime(now)],
          );
          if (rowsAffectedOf(inserted) === 0 && !("rowsAffected" in (inserted as object))) {
            /* memory and TiDB both report rowsAffected 1; a missing field is still an insert */
          }
        } catch (error) {
          if (!duplicateRow(error)) throw error;
          const raced = await find(issuerKey, subjectKey);
          if (!raced) throw error;
          return raced;
        }
        const confirmed = await find(issuerKey, subjectKey);
        if (!confirmed) throw new Error("identity_missing");
        return confirmed;
      } catch (error) {
        if (missingTable(error)) throw new IdentityTableMissing();
        throw error;
      }
    },
  };
}
