import type { MarketFreshness } from "@quki/analytics";
import { describe, expect, it } from "vitest";

import { createApp, type MarketSource } from "./app.js";

const emptyFreshness = {
  asOf: null,
  expectedSession: null,
  indexThrough: null,
  lastSuccess: null,
  quotesStale: null,
  indexStale: null,
  stale: null,
  calendarKnown: null,
};

const fridayMiss: MarketFreshness = {
  asOf: "2026-11-12T10:08:49.000Z",
  expectedSession: "2026-11-13",
  indexThrough: "2026-11-11",
  lastSuccess: { job: "dividends_events", at: "2026-11-12T10:08:49.000Z" },
  quotesStale: true,
  indexStale: true,
  stale: true,
  calendarKnown: true,
};

function source(overrides: Partial<MarketSource> & Pick<MarketSource, "mode">): MarketSource {
  return {
    async listInstruments() {
      return [];
    },
    async getDailyBars() {
      return [];
    },
    async countInstruments() {
      return 0;
    },
    ...overrides,
  };
}

describe("/api/health", () => {
  it("includes the instrument count and no connection details", async () => {
    const app = createApp(
      source({
        mode: "tidb",
        async countInstruments() {
          return 8;
        },
      }),
    );
    const response = await app.request("http://quki.test/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      storage: "tidb",
      instruments: 8,
      ...emptyFreshness,
    });
  });

  it("reports a missed trading session without failing the storage check", async () => {
    const app = createApp(
      source({
        mode: "tidb",
        async countInstruments() {
          return 8;
        },
        async getFreshness() {
          return fridayMiss;
        },
      }),
    );
    const response = await app.request("http://quki.test/api/health");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      instruments: 8,
      asOf: "2026-11-12T10:08:49.000Z",
      expectedSession: "2026-11-13",
      indexThrough: "2026-11-11",
      stale: true,
    });
    expect(JSON.stringify(body)).not.toContain("mysql://");
  });

  it("keeps storage ok when the freshness query throws", async () => {
    const app = createApp(
      source({
        mode: "tidb",
        async countInstruments() {
          return 8;
        },
        async getFreshness() {
          throw new Error("mysql://user:secret@gateway.example/quki");
        },
      }),
    );
    const response = await app.request("http://quki.test/api/health");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, instruments: 8, stale: null, asOf: null });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(JSON.stringify(body)).not.toContain("mysql://");
  });

  it("fails closed when the count query throws", async () => {
    const app = createApp(
      source({
        mode: "tidb",
        async countInstruments() {
          throw new Error("mysql://user:secret@gateway.example/quki");
        },
      }),
    );
    const response = await app.request("http://quki.test/api/health");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({ ok: false, storage: "tidb", instruments: null, ...emptyFreshness });
    expect(JSON.stringify(body)).not.toContain("mysql://");
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
