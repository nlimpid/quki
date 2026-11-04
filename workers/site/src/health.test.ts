import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";

describe("/api/health", () => {
  it("returns only ok and storage", async () => {
    const app = createApp({
      mode: "fixture",
      async listInstruments() {
        return [];
      },
      async getDailyBars() {
        return [];
      },
    });
    const response = await app.request("http://quki.test/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, storage: "fixture" });
  });
});
