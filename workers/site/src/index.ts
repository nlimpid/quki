import {
  DATABASE_URL_ENV,
  connectTiDb,
  instrumentId,
  listInstrumentIds,
  loadDailyBars,
} from "@quki/db";
import { findInstrument, type InstrumentInfo } from "@quki/types";

import { createApp, type MarketSource } from "./app.js";

export interface Env {
  TIDB_QUKI_DATABASE_URL?: string;
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

function tidbSource(url: string): MarketSource {
  const conn = connectTiDb(url);
  return {
    mode: "tidb",
    async listInstruments() {
      const rows = await listInstrumentIds(conn);
      const instruments: InstrumentInfo[] = [];
      for (const row of rows) {
        const info = findInstrument(row.symbol);
        if (info) instruments.push(info);
      }
      return instruments;
    },
    async getDailyBars(symbol) {
      const id = await instrumentId(conn, symbol);
      if (!id) return null;
      return loadDailyBars(conn, id);
    },
  };
}

function unconfiguredSource(): MarketSource {
  return {
    mode: "tidb",
    async listInstruments() {
      return [];
    },
    async getDailyBars() {
      throw new Error(`缺少 Worker secret ${DATABASE_URL_ENV}`);
    },
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const source = env.TIDB_QUKI_DATABASE_URL
        ? tidbSource(env.TIDB_QUKI_DATABASE_URL)
        : unconfiguredSource();
      return createApp(source).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
