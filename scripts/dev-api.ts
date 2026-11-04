import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { serve } from "@hono/node-server";
import { dedupeBars, dropClonedBaseRows, parseSeedCsv, seedToDaily } from "@quki/ingest";
import { SEEDED_INSTRUMENTS, findInstrument, type DailyBar } from "@quki/types";

import { createApp, type MarketSource } from "../workers/site/src/app.js";

const cache = new Map<string, DailyBar[]>();

function load(symbol: string): DailyBar[] {
  const cached = cache.get(symbol);
  if (cached) return cached;
  const path = resolve("data/seed", `${symbol}.csv`);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const bars = seedToDaily(dropClonedBaseRows(dedupeBars(parseSeedCsv(text))));
  cache.set(symbol, bars);
  return bars;
}

const source: MarketSource = {
  mode: "fixture",
  async listInstruments() {
    return [...SEEDED_INSTRUMENTS];
  },
  async getDailyBars(symbol: string) {
    const instrument = findInstrument(symbol);
    if (!instrument) return null;
    return load(symbol);
  },
  async countInstruments() {
    return SEEDED_INSTRUMENTS.length;
  },
};

const app = createApp(source);
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`quki api (fixture seed CSVs) http://127.0.0.1:${port}`);
});
