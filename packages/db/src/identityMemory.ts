import type { SqlConn } from "./client.js";

/** In-process stand-in. Not TiDB. Compares issuer and subject as raw bytes. */

type Row = { id: string; issuer: Uint8Array; subject: Uint8Array };

function asBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error("identity parameter must be bytes");
  return value;
}

function same(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function createIdentityMemoryConn(): SqlConn & { rows: Row[] } {
  const rows: Row[] = [];
  return {
    rows,
    async execute(sql: string, params: unknown[] = []) {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text.startsWith("SELECT id FROM auth_identities ")) {
        const issuer = asBytes(params[0]);
        const subject = asBytes(params[1]);
        const row = rows.find((item) => same(item.issuer, issuer) && same(item.subject, subject));
        return { rows: row ? [{ id: row.id }] : [] };
      }
      if (text.startsWith("INSERT INTO auth_identities ")) {
        const issuer = asBytes(params[1]);
        const subject = asBytes(params[2]);
        if (rows.some((item) => same(item.issuer, issuer) && same(item.subject, subject))) {
          throw new Error("Duplicate entry 'uk_auth_identities'");
        }
        rows.push({ id: String(params[0]), issuer, subject });
        return { rows: [], rowsAffected: 1 };
      }
      throw new Error(`identity memory does not implement ${text}`);
    },
  };
}
