import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { rowsOf, type SqlConn } from "./client.js";
import { splitSql } from "./sql.js";

const BOOKKEEPING = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename VARCHAR(255) NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (filename)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

export function defaultMigrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../../db/migrations");
}

export type MigrationFile = { filename: string; sql: string };

export function readMigrationFiles(dir = defaultMigrationsDir()): MigrationFile[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((filename) => ({ filename, sql: readFileSync(join(dir, filename), "utf8") }));
}

export async function applyMigrations(
  conn: SqlConn,
  files: readonly MigrationFile[],
): Promise<string[]> {
  await conn.execute(BOOKKEEPING);
  const applied = new Set<string>();
  const existing = await conn.execute("SELECT filename FROM schema_migrations");
  for (const row of rowsOf(existing)) {
    if ("filename" in row) applied.add(String(row.filename));
  }
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file.filename)) continue;
    for (const statement of splitSql(file.sql)) {
      await conn.execute(statement);
    }
    await conn.execute("INSERT INTO schema_migrations (filename) VALUES (?)", [file.filename]);
    ran.push(file.filename);
  }
  return ran;
}
