import { alignCloses, buildOverview, buildRotationView, computeRotation } from "@quki/analytics";
import {
  findInstrument,
  findRotationPair,
  resolveRotationPair,
  ROTATION_PAIRS,
  type DailyBar,
  type InstrumentInfo,
} from "@quki/types";
import { Hono } from "hono";

export type MarketSource = {
  mode: "fixture" | "tidb";
  listInstruments: () => Promise<InstrumentInfo[]>;
  getDailyBars: (symbol: string) => Promise<DailyBar[] | null>;
};

export function createApp(source: MarketSource) {
  const app = new Hono();

  app.get("/api/health", (c) => {
    const body: { ok: true; storage: "fixture" | "tidb" } = { ok: true, storage: source.mode };
    return c.json(body);
  });

  app.get("/api/instruments", async (c) => {
    const instruments = await source.listInstruments();
    return c.json({ instruments });
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
    return c.json(overview);
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
