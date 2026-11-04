import { describe, expect, it } from "vitest";

import { createApp, type MarketSource } from "./app.js";

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
    expect(await response.json()).toEqual({ ok: true, storage: "tidb", instruments: 8 });
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
    expect(body).toEqual({ ok: false, storage: "tidb", instruments: null });
    expect(JSON.stringify(body)).not.toContain("mysql://");
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
