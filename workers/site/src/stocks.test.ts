import { YIELD_NOTE } from "@quki/types";
import { describe, expect, it } from "vitest";

import { adjustedCashPerShare, trailingCashYield } from "@quki/analytics";

import { createApp } from "./app.js";
import {
  FIXTURE_AS_OF,
  getFixtureStock,
  listFixtureStocks,
  lookupFixtureStocks,
} from "./stockFixture.js";

function app() {
  return createApp({
    mode: "fixture",
    async listInstruments() {
      return [];
    },
    async getDailyBars() {
      return [];
    },
    async countInstruments() {
      return 0;
    },
    listStocks: listFixtureStocks,
    getStock: getFixtureStock,
    async lookupStocks(codes) {
      return { items: await lookupFixtureStocks(codes), isSample: true };
    },
  });
}

describe("stock dividend API", () => {
  it("lists Shanghai and Shenzhen names, hides Beijing, and sorts by yield", async () => {
    const listed = await app().request("http://quki.test/api/stocks?market=ALL");
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      isSample: boolean;
      yieldNote: string;
      total: number;
      items: { code: string; exchange: string }[];
    };
    expect(body.isSample).toBe(true);
    expect(body.yieldNote).toBe(YIELD_NOTE);
    expect(body.items.map((item) => item.code)).not.toContain("920000");
    expect(body.items.every((item) => item.exchange === "SH" || item.exchange === "SZ")).toBe(true);
    const sh = await app().request("http://quki.test/api/stocks?market=SH&q=茅台");
    const shBody = (await sh.json()) as { total: number; items: { code: string }[] };
    expect(shBody.total).toBe(1);
    expect(shBody.items[0]?.code).toBe("600519");
    const beijing = await app().request("http://quki.test/api/stocks?market=BJ");
    expect(((await beijing.json()) as { total: number }).total).toBe(0);
    const sorted = await app().request("http://quki.test/api/stocks?sort=yield");
    const yields = ((await sorted.json()) as { items: { trailingYieldPct: number | null }[] })
      .items;
    const numbers = yields.map((item) => item.trailingYieldPct).filter((value) => value != null);
    const ordered = [...numbers].sort((a, b) => b - a);
    expect(numbers).toEqual(ordered);
  });

  it("serves a 10-year default detail and adjusts same-day transfer cash", async () => {
    const missing = await app().request("http://quki.test/api/stocks/999999");
    expect(missing.status).toBe(404);
    const bad = await app().request("http://quki.test/api/stocks/12");
    expect(bad.status).toBe(400);
    const detail = await app().request("http://quki.test/api/stocks/000002");
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      years: string;
      company: { trailingYieldPct: number; ttmCashPerShare: number; lastClose: number };
      events: { exDate: string; adjustedCashPerShare: number; transferPer10: number }[];
    };
    expect(body.years).toBe("10");
    expect(body.events).toHaveLength(1);
    expect(body.events[0]?.adjustedCashPerShare).toBeCloseTo(0.5, 8);
    expect(body.company.ttmCashPerShare).toBeCloseTo(0.5, 8);
    expect(body.company.trailingYieldPct).toBeCloseTo(5, 8);
    const expected = trailingCashYield({
      asOf: FIXTURE_AS_OF,
      price: 10,
      events: [{ exDate: "2026-03-01", cashPerShare: 1, bonusPer10: 0, transferPer10: 10 }],
    });
    expect(body.company.trailingYieldPct).toBeCloseTo(expected.yieldPct ?? 0, 8);
    expect(
      adjustedCashPerShare(
        { exDate: "2026-03-01", cashPerShare: 1, bonusPer10: 0, transferPer10: 10 },
        [{ exDate: "2026-03-01", cashPerShare: 1, bonusPer10: 0, transferPer10: 10 }],
      ),
    ).toBeCloseTo(0.5, 8);
    const history = await app().request("http://quki.test/api/stocks/000725?years=10");
    const historyBody = (await history.json()) as { events: { exDate: string }[] };
    expect(historyBody.events.map((event) => event.exDate)).toEqual(["2026-06-18"]);
    const all = await app().request("http://quki.test/api/stocks/000725?years=MAX");
    const allBody = (await all.json()) as { events: { exDate: string; eventType: string }[] };
    expect(allBody.events.map((event) => event.exDate)).toContain("2011-06-20");
    expect(allBody.events.find((event) => event.exDate === "2011-06-20")?.eventType).toBe(
      "transfer",
    );
  });

  it("looks up holdings quotes and grays a stale price by flag", async () => {
    const response = await app().request(
      "http://quki.test/api/stocks/batch?codes=000001,300750,920000",
    );
    const body = (await response.json()) as {
      isSample: boolean;
      items: {
        code: string;
        quoteFresh: boolean;
        lastClose: number | null;
        trailingYieldPct: number | null;
      }[];
    };
    expect(body.isSample).toBe(true);
    expect(body.items.map((item) => item.code)).toEqual(["000001", "300750"]);
    expect(body.items[0]).toMatchObject({
      quoteFresh: false,
      lastClose: 11.2,
      trailingYieldPct: null,
    });
    const staleDetail = await app().request("http://quki.test/api/stocks/000001");
    const staleBody = (await staleDetail.json()) as {
      company: { quoteFresh: boolean; trailingYieldPct: number | null; ttmCashPerShare: number };
    };
    expect(staleBody.company.quoteFresh).toBe(false);
    expect(staleBody.company.trailingYieldPct).toBeNull();
    expect(staleBody.company.ttmCashPerShare).toBeGreaterThan(0);
    expect(body.items[1]).toMatchObject({ lastClose: null, trailingYieldPct: null });
  });
});
