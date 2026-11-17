import { createHoldingStore, HOLDING_SHARES_MAX } from "@quki/db";
import { createCandidateHoldingMemoryConn } from "../../../../packages/db/src/holdingMemory.js";
import { describe, expect, it } from "vitest";

import { createApp, type MarketSource } from "../app.js";
import { clearClerkJwksCache } from "../auth/clerkVerify.js";
import { fixtureKey, signSessionToken } from "../auth/clerkTestToken.js";
import type { AuthRuntime } from "../auth/runtime.js";

const origin = "http://quki.test";
const version = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function market(): MarketSource {
  return {
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
  };
}

function appFor(statements: string[]) {
  clearClerkJwksCache();
  const key = fixtureKey();
  const memory = createCandidateHoldingMemoryConn(["600519"]);
  let versions = 0;
  const auth: AuthRuntime = {
    now: () => new Date("2026-11-17T00:00:00.000Z"),
    store: null,
    holdings: createHoldingStore(
      () => ({
        execute(sql: string, params?: unknown[]) {
          statements.push(sql);
          return memory.execute(sql, params);
        },
      }),
      {
        newVersion: () =>
          ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "cccccccccccccccccccccccccccccccc"][versions++] ??
          version,
      },
    ),
    clerk: {
      issuer: "https://trusted.example",
      authorizedParties: ["https://quki.cc"],
      fetchJwks: async () => new Response(JSON.stringify(key.jwks), { status: 200 }),
    },
    identities: {
      async resolve() {
        statements.push("identity");
        return "11111111-1111-4111-8111-111111111111";
      },
    },
    oidc: null,
    unavailableReason: null,
    trustedOrigins: [origin],
  };
  const token = signSessionToken(key.privateKey, {
    iss: "https://trusted.example",
    sub: "user_fixture_subject",
    azp: "https://quki.cc",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
  });
  return { app: createApp(market(), auth), token, key };
}

async function put(
  app: ReturnType<typeof createApp>,
  token: string,
  body: string,
  path = "/api/holdings",
) {
  return app.request(`${origin}${path}`, {
    method: "PUT",
    headers: {
      origin,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body,
  });
}

describe("account share guard", () => {
  it("rejects invalid share JSON before identity or holdings SQL, and accepts 1 and 1e9", async () => {
    const statements: string[] = [];
    const { app, token } = appFor(statements);
    const identityBefore = statements.length;
    const badBodies = [
      "{",
      "{}",
      JSON.stringify({ code: "600519", expectedVersion: null }),
      JSON.stringify({ code: "600519", shares: null, expectedVersion: null }),
      JSON.stringify({ code: "600519", shares: "10", expectedVersion: null }),
      JSON.stringify({ code: "600519", shares: true, expectedVersion: null }),
      JSON.stringify({ code: "600519", shares: 0, expectedVersion: null }),
      JSON.stringify({ code: "600519", shares: -1, expectedVersion: null }),
      JSON.stringify({ code: "600519", shares: 1.5, expectedVersion: null }),
      JSON.stringify({ code: "600519", shares: HOLDING_SHARES_MAX + 1, expectedVersion: null }),
      JSON.stringify({ code: "600519", shares: Number.NaN, expectedVersion: null }),
      JSON.stringify({ code: "600519", shares: Number.POSITIVE_INFINITY, expectedVersion: null }),
    ];
    for (const body of badBodies) {
      const response = await put(app, token, body);
      expect(response.status).toBe(400);
      const pathResponse = await put(app, token, body, "/api/holdings/600519");
      expect(pathResponse.status).toBe(400);
    }
    expect(statements).toHaveLength(identityBefore);
    expect(statements.some((sql) => sql.includes("auth_identities"))).toBe(false);
    expect(statements.some((sql) => sql.includes("auth_holdings"))).toBe(false);

    const created = await put(
      app,
      token,
      JSON.stringify({ code: "600519", shares: 1, expectedVersion: null }),
    );
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { version: string; shares: number };
    expect(createdBody.shares).toBe(1);
    const updated = await put(
      app,
      token,
      JSON.stringify({
        code: "600519",
        shares: HOLDING_SHARES_MAX,
        expectedVersion: createdBody.version,
      }),
    );
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { shares: number }).shares).toBe(HOLDING_SHARES_MAX);
    const pathUpdated = await put(
      app,
      token,
      JSON.stringify({ shares: 1, expectedVersion: "cccccccccccccccccccccccccccccccc" }),
      "/api/holdings/600519",
    );
    expect([200, 409]).toContain(pathUpdated.status);
    expect(statements.some((sql) => sql.includes("INSERT INTO auth_holdings"))).toBe(true);
    expect(statements.some((sql) => sql.includes("UPDATE auth_holdings"))).toBe(true);

    const beforeInvalidUpdate = statements.length;
    const rejectedUpdate = await put(
      app,
      token,
      JSON.stringify({ code: "600519", shares: 0, expectedVersion: createdBody.version }),
    );
    expect(rejectedUpdate.status).toBe(400);
    expect(statements).toHaveLength(beforeInvalidUpdate);
  });
});
