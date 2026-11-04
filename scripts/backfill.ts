import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DATABASE_URL_ENV,
  connectTiDb,
  instrumentId,
  loadDailyBars,
  recomputeAnalytics,
  recomputeStoredPairs,
  upsertBars,
} from "@quki/db";
import { dedupeBars, dropClonedBaseRows, parseSeedCsv, seedToDaily } from "@quki/ingest";
import { SEEDED_INSTRUMENTS } from "@quki/types";

import { loadDevVars } from "./dev-vars.js";

loadDevVars();

if (!process.env[DATABASE_URL_ENV]) {
  console.error(`Set ${DATABASE_URL_ENV} (see .dev.vars.example) and re-run pnpm backfill.`);
  process.exit(1);
}

const conn = connectTiDb();
const only = process.argv.slice(2);

for (const instrument of SEEDED_INSTRUMENTS) {
  if (only.length > 0 && !only.includes(instrument.symbol)) continue;
  const id = await instrumentId(conn, instrument.symbol);
  if (!id) {
    throw new Error(`No instruments row for ${instrument.symbol}. Run pnpm migrate first.`);
  }
  const csvPath = resolve("data/seed", `${instrument.symbol}.csv`);
  if (!existsSync(csvPath)) {
    console.warn(`skip ${instrument.symbol}: no seed csv yet`);
    continue;
  }
  const text = readFileSync(csvPath, "utf8");
  const seed = dropClonedBaseRows(dedupeBars(parseSeedCsv(text)));
  const written = await upsertBars(conn, id, seed, "D");
  const daily = seedToDaily(seed);
  const weeks = await recomputeAnalytics(conn, id, daily);
  const check = await loadDailyBars(conn, id);
  const june = check.find((bar) => bar.date === "2026-06-29" && instrument.symbol === "H30269");
  console.log(
    `backfill ${instrument.symbol}: upserted ${written} daily bars, ${weeks} weekly MA points, stored ${check.length}`,
  );
  if (june) console.log(`  H30269 2026-06-29 close ${june.close}`);
}
await recomputeStoredPairs(conn);
