import type { DailyBar, TemperatureResponse } from "@quki/types";
import { describe, expect, it } from "vitest";

import { createApp, type MarketSource } from "./app.js";

function reading(temperature: number): TemperatureResponse {
  return {
    asOf: "2026-11-03T15:00:00+08:00",
    tradeDate: "2026-11-03",
    temperature,
    band: "hot",
    label: "偏贵",
    extreme: null,
    semantics: "high_means_expensive",
    method: "quantile_blend",
    version: 1,
    pa: 68.2,
    pb: 74.5,
    spread40: 0.031,
    ratio: 1.042,
    weightOwn: 0.5,
    coldMax: 10,
    hotMin: 90,
    dividend: {
      symbol: "H00922",
      name: "中证红利全收益",
      priceSymbol: "000922",
      priceName: "中证红利",
    },
    broad: { symbol: "H20903", name: "中证A股全收益" },
    history: [{ date: "2026-11-03", temperature, pa: 68.2, pb: 74.5, spread40: 0.031 }],
  };
}

function source(overrides: Partial<MarketSource> = {}): MarketSource {
  return {
    mode: "fixture",
    async listInstruments() {
      return [];
    },
    async getDailyBars() {
      return [
        {
          date: "2026-11-03",
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 1,
          amount: 1,
        },
      ];
    },
    async countInstruments() {
      return 1;
    },
    ...overrides,
  };
}

function fridays(count: number): DailyBar[] {
  const start = new Date("2018-01-05T00:00:00Z");
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index * 7);
    return {
      date: date.toISOString().slice(0, 10),
      open: 100,
      high: 100,
      low: 100,
      close: 100 + index,
      volume: 1,
      amount: 1,
    };
  });
}

describe("/api/temperature", () => {
  it("returns the stored series", async () => {
    const app = createApp(
      source({
        async getTemperature() {
          return reading(72);
        },
      }),
    );
    const response = await app.request("http://quki.test/api/temperature");
    expect(response.status).toBe(200);
    const body = (await response.json()) as TemperatureResponse;
    expect(body.temperature).toBe(72);
    expect(body.semantics).toBe("high_means_expensive");
    expect(body.pa).toBe(68.2);
    expect(body.pb).toBe(74.5);
    expect(body.spread40).toBe(0.031);
    expect(body.history).toHaveLength(1);
    expect(body.method).toBe("quantile_blend");
    expect(body.version).toBe(1);
  });

  it("rejects an unknown family and an empty series", async () => {
    const app = createApp(
      source({
        async getTemperature() {
          return null;
        },
      }),
    );
    const bad = await app.request("http://quki.test/api/temperature?family=other");
    expect(bad.status).toBe(400);
    const missing = await app.request(
      "http://quki.test/api/temperature?family=lowvol&broad=H00985",
    );
    expect(missing.status).toBe(404);
  });

  it("puts a compact temperature on the dividend overview and still responds if the lookup fails", async () => {
    const bars = fridays(80);
    const ok = createApp(
      source({
        async getDailyBars() {
          return bars;
        },
        async getTemperature(query) {
          expect(query).toEqual({ family: "dividend", broad: "H20903" });
          return reading(41);
        },
      }),
    );
    const response = await ok.request("http://quki.test/api/indices/H00922/overview");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      temperature: { value: number; pa: number; spread40: number };
    };
    expect(body.temperature.value).toBe(41);
    expect(body.temperature.pa).toBe(68.2);
    expect(body.temperature.spread40).toBe(0.031);

    const failing = createApp(
      source({
        async getDailyBars() {
          return bars;
        },
        async getTemperature() {
          throw new Error("mysql://user:secret@db/quki");
        },
      }),
    );
    const fallback = await failing.request("http://quki.test/api/indices/000922/overview");
    expect(fallback.status).toBe(200);
    const fallbackBody = (await fallback.json()) as { temperature: null; lastClose: number };
    expect(fallbackBody.temperature).toBeNull();
    expect(fallbackBody.lastClose).toBeGreaterThan(0);
    expect(JSON.stringify(fallbackBody)).not.toContain("secret");
  });
});
