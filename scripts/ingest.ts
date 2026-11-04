import { DATABASE_URL_ENV, connectTiDb, ingestAll } from "@quki/db";

import { loadDevVars } from "./dev-vars.js";

loadDevVars();

const mode = process.argv.includes("--backfill") ? "backfill" : "incremental";
const symbols = process.argv.filter((arg) => !arg.startsWith("-") && arg !== mode);
if (!process.env[DATABASE_URL_ENV]) {
  console.error(`Set ${DATABASE_URL_ENV} before pnpm ingest.`);
  process.exit(1);
}

await ingestAll(connectTiDb(), mode, symbols.length > 0 ? symbols : undefined);
