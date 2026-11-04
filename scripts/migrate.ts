import { DATABASE_URL_ENV, applyMigrations, connectTiDb, readMigrationFiles } from "@quki/db";

import { loadDevVars } from "./dev-vars.js";

loadDevVars();

if (!process.env[DATABASE_URL_ENV]) {
  console.error(`Set ${DATABASE_URL_ENV} (see .dev.vars.example) and re-run pnpm migrate.`);
  process.exit(1);
}

const conn = connectTiDb();
const ran = await applyMigrations(conn, readMigrationFiles());
if (ran.length === 0) console.log("migrations: already applied");
else console.log(`migrations applied: ${ran.join(", ")}`);
