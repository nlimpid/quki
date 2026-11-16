import {
  buildTemperatureReading,
  paramsHash,
  productionStudyParams,
  temperatureLegs,
} from "@quki/analytics";
import {
  DATABASE_URL_ENV,
  connectTiDb,
  createHoldingsStore,
  getStockDetail,
  lookupHoldingCash,
  instrumentId,
  listInstrumentIds,
  listStocks as queryStocks,
  loadDailyBars,
  loadTemperatureSeries,
  lookupStocks as queryLookup,
  numOrNull,
  readMarketFreshness,
  rowsOf,
} from "@quki/db";
import { findInstrument, type InstrumentInfo } from "@quki/types";

import { createApp, type MarketSource } from "./app.js";
import { authRuntimeFromEnv } from "./auth/runtime.js";
import { unconfiguredHoldings, type HoldingsRuntime } from "./holdings/routes.js";

export interface Env {
  TIDB_QUKI_DATABASE_URL?: string;
  AUTH_OIDC_ISSUER?: string;
  AUTH_OIDC_CLIENT_ID?: string;
  AUTH_OIDC_CLIENT_SECRET?: string;
  /** Must stay `openid` until the consent copy is replaced. Other scopes fail closed. */
  AUTH_OIDC_SCOPES?: string;
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
    async countInstruments() {
      const result = await conn.execute("SELECT COUNT(*) AS instrument_count FROM instruments");
      const row = rowsOf(result)[0];
      const count = numOrNull(row?.instrument_count);
      if (count == null) throw new Error("instrument count query returned no row");
      return count;
    },
    async getTemperature(query) {
      const legs = temperatureLegs(query.family, query.broad);
      const id = await instrumentId(conn, legs.totalReturnSymbol);
      if (!id) return null;
      const hash = await paramsHash(productionStudyParams(legs));
      const points = await loadTemperatureSeries(conn, id, hash);
      return buildTemperatureReading(points, legs);
    },
    listStocks(query) {
      return queryStocks(conn, query);
    },
    getStock(code, years) {
      return getStockDetail(conn, code, years);
    },
    async lookupStocks(codes) {
      return { items: await queryLookup(conn, codes), isSample: false };
    },
    getFreshness() {
      return readMarketFreshness(conn);
    },
  };
}

function holdingsRuntime(url: string | undefined): HoldingsRuntime {
  if (!url) return unconfiguredHoldings();
  return {
    ...unconfiguredHoldings(),
    store: createHoldingsStore(() => connectTiDb(url)),
    quotes: (codes) => lookupHoldingCash(connectTiDb(url), codes),
    vision: null,
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
    async countInstruments() {
      throw new Error(`缺少 Worker secret ${DATABASE_URL_ENV}`);
    },
    async listStocks() {
      throw new Error(`缺少 Worker secret ${DATABASE_URL_ENV}`);
    },
    async getStock() {
      throw new Error(`缺少 Worker secret ${DATABASE_URL_ENV}`);
    },
    async lookupStocks() {
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
      return createApp(
        source,
        authRuntimeFromEnv(env, connectTiDb),
        holdingsRuntime(env.TIDB_QUKI_DATABASE_URL),
      ).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
