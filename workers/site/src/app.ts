import {
  alignCloses,
  buildOverview,
  buildRotationView,
  compactTemperature,
  computeRotation,
  parseTemperatureQuery,
  temperatureFamilyForSymbol,
} from "@quki/analytics";
import {
  findInstrument,
  findRotationPair,
  resolveRotationPair,
  ROTATION_PAIRS,
  type DailyBar,
  type DividendYears,
  type InstrumentInfo,
  type OverviewTemperature,
  type StockDetailResponse,
  type StockListItem,
  type StockListQuery,
  type StockListResponse,
  type StockMarketFilter,
  type StockSort,
  type TemperatureFamilyId,
  type TemperatureResponse,
} from "@quki/types";
import { Hono } from "hono";

export type MarketSource = {
  mode: "fixture" | "tidb";
  listInstruments: () => Promise<InstrumentInfo[]>;
  getDailyBars: (symbol: string) => Promise<DailyBar[] | null>;
  /** TiDB path must run SELECT COUNT(*) FROM instruments. */
  countInstruments: () => Promise<number>;
  /** Stored dividend temperature. Fixture mode may compute it from bars. */
  getTemperature?: (query: {
    family: TemperatureFamilyId;
    broad: "H20903" | "H00985";
  }) => Promise<TemperatureResponse | null>;
  listStocks?: (query: StockListQuery) => Promise<StockListResponse>;
  getStock?: (code: string, years: DividendYears) => Promise<StockDetailResponse | null>;
  lookupStocks?: (codes: string[]) => Promise<{ items: StockListItem[]; isSample: boolean }>;
};

function publicStorageMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "storage_error";
  if (message.includes("://") || message.toLowerCase().includes("password")) return "存储不可用";
  return message;
}

function parseMarket(value: string | undefined): StockMarketFilter {
  if (value === "SH" || value === "SZ" || value === "BJ") return value;
  return "ALL";
}

function parseSort(value: string | undefined): StockSort {
  if (value === "yield" || value === "lastDivDate") return value;
  return "code";
}

function parseYears(value: string | undefined): DividendYears {
  if (value === "5" || value === "10" || value === "MAX") return value;
  return "10";
}

function parsePage(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function readOverviewTemperature(
  source: MarketSource,
  symbol: string,
): Promise<OverviewTemperature | null> {
  const family = temperatureFamilyForSymbol(symbol);
  if (!family || !source.getTemperature) return null;
  try {
    const reading = await source.getTemperature({ family, broad: "H20903" });
    return reading ? compactTemperature(reading) : null;
  } catch (error) {
    console.error(
      `temperature lookup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export function createApp(source: MarketSource) {
  const app = new Hono();

  app.get("/api/health", async (c) => {
    try {
      const instruments = await source.countInstruments();
      return c.json({ ok: true, storage: source.mode, instruments });
    } catch {
      return c.json({ ok: false, storage: source.mode, instruments: null }, 503);
    }
  });

  app.get("/api/instruments", async (c) => {
    const instruments = await source.listInstruments();
    return c.json({ instruments });
  });

  app.get("/api/stocks/batch", async (c) => {
    if (!source.lookupStocks) {
      return c.json({ error: "storage_error", message: "分红列表尚未接入" }, 503);
    }
    const codes = (c.req.query("codes") ?? "")
      .split(",")
      .map((code) => code.trim())
      .filter((code) => /^\d{6}$/.test(code))
      .slice(0, 50);
    try {
      return c.json(await source.lookupStocks(codes));
    } catch (error) {
      return c.json({ error: "storage_error", message: publicStorageMessage(error) }, 503);
    }
  });

  app.get("/api/stocks", async (c) => {
    if (!source.listStocks) {
      return c.json({ error: "storage_error", message: "分红列表尚未接入" }, 503);
    }
    const query: StockListQuery = {
      q: c.req.query("q") ?? "",
      market: parseMarket(c.req.query("market")),
      sort: parseSort(c.req.query("sort")),
      page: parsePage(c.req.query("page"), 1),
      pageSize: parsePage(c.req.query("pageSize"), 50),
    };
    try {
      return c.json(await source.listStocks(query));
    } catch (error) {
      return c.json({ error: "storage_error", message: publicStorageMessage(error) }, 503);
    }
  });

  app.get("/api/stocks/:code", async (c) => {
    if (!source.getStock) {
      return c.json({ error: "storage_error", message: "分红详情尚未接入" }, 503);
    }
    const code = c.req.param("code");
    if (!/^\d{6}$/.test(code)) {
      return c.json({ error: "bad_code", message: "股票代码需为 6 位数字" }, 400);
    }
    try {
      const detail = await source.getStock(code, parseYears(c.req.query("years")));
      if (!detail) return c.json({ error: "not_found", message: "未找到该股票" }, 404);
      return c.json(detail);
    } catch (error) {
      return c.json({ error: "storage_error", message: publicStorageMessage(error) }, 503);
    }
  });

  app.get("/api/indices/:code/overview", async (c) => {
    const code = c.req.param("code").toUpperCase();
    const instrument = findInstrument(code);
    if (!instrument) return c.json({ error: "unknown_instrument" }, 404);
    let bars: DailyBar[] | null;
    try {
      bars = await source.getDailyBars(code);
    } catch (error) {
      const message = error instanceof Error ? error.message : "storage_error";
      return c.json({ error: "storage_error", message }, 503);
    }
    if (!bars || bars.length === 0) {
      return c.json(
        {
          error: "no_bars",
          message: "尚无行情。设置 TIDB_QUKI_DATABASE_URL 后运行 pnpm migrate && pnpm backfill。",
        },
        404,
      );
    }
    const overview = buildOverview(bars, instrument);
    if (!overview) return c.json({ error: "no_bars" }, 404);
    const temperature = await readOverviewTemperature(source, code);
    return c.json({ ...overview, temperature });
  });

  app.get("/api/temperature", async (c) => {
    const parsed = parseTemperatureQuery(c.req.query("family"), c.req.query("broad"));
    if (!parsed) return c.json({ error: "bad_query" }, 400);
    if (!source.getTemperature) {
      return c.json({ error: "no_temperature", message: "温度序列尚未接入。" }, 404);
    }
    let reading: TemperatureResponse | null;
    try {
      reading = await source.getTemperature(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : "storage_error";
      return c.json({ error: "storage_error", message }, 503);
    }
    if (!reading) {
      return c.json(
        {
          error: "no_temperature",
          message: "尚无温度序列。爬虫会在行情更新后写入，或运行 pnpm backfill。",
        },
        404,
      );
    }
    return c.json(reading);
  });

  app.get("/api/rotation/pairs", (c) =>
    c.json({
      pairs: ROTATION_PAIRS.map((pair) => {
        const resolved = resolveRotationPair(pair);
        return {
          id: resolved.id,
          title: resolved.title,
          a: resolved.a,
          b: resolved.b,
          totalReturn: resolved.totalReturn,
        };
      }),
    }),
  );

  app.get("/api/rotation/:pairId", async (c) => {
    const definition = findRotationPair(c.req.param("pairId"));
    if (!definition) return c.json({ error: "unknown_pair" }, 404);
    const pair = resolveRotationPair(definition);
    let barsA: DailyBar[] | null;
    let barsB: DailyBar[] | null;
    try {
      barsA = await source.getDailyBars(pair.a);
      barsB = await source.getDailyBars(pair.b);
    } catch (error) {
      const message = error instanceof Error ? error.message : "storage_error";
      return c.json({ error: "storage_error", message }, 503);
    }
    if (!barsA?.length || !barsB?.length) {
      return c.json(
        {
          error: "no_bars",
          message: `尚无 ${pair.a} 或 ${pair.b} 的行情。爬虫会从中证指数拉取，或运行 pnpm backfill。`,
        },
        404,
      );
    }
    const view = buildRotationView(computeRotation(alignCloses(barsA, barsB)), pair);
    if (!view) return c.json({ error: "no_bars" }, 404);
    return c.json(view);
  });

  return app;
}
