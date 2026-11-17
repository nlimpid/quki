import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { fixtureKey, signSessionToken } from "./clerkTestToken.js";
import {
  bearerFromAuthorization,
  clearClerkJwksCache,
  jwksUrlForIssuer,
  verifyClerkSessionToken,
  type ClerkVerifyConfig,
} from "./clerkVerify.js";

const issuer = "https://trusted.example";
const config: ClerkVerifyConfig = {
  issuer,
  authorizedParties: ["https://quki.cc", "https://www.quki.cc"],
};
const now = Date.parse("2026-11-17T00:00:00.000Z");

function payload(extra: Record<string, unknown> = {}) {
  return {
    iss: issuer,
    sub: "user_fixture_subject_with_mixed_CASE_and_a_long_tail_0123456789",
    azp: "https://quki.cc",
    exp: Math.floor(now / 1000) + 60,
    nbf: Math.floor(now / 1000) - 5,
    iat: Math.floor(now / 1000) - 5,
    ...extra,
  };
}

function jwksFetch(body: unknown, hits: string[] = []): typeof fetch {
  return async (input) => {
    hits.push(String(input));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

describe("clerk session token crypto, not a mocked auth result", () => {
  it("accepts a signed session token and fetches only the configured issuer", async () => {
    clearClerkJwksCache();
    const key = fixtureKey();
    const hits: string[] = [];
    const token = signSessionToken(key.privateKey, payload());
    const verified = await verifyClerkSessionToken(token, config, jwksFetch(key.jwks, hits), now);
    expect(verified).toEqual({
      ok: true,
      issuer,
      subject: "user_fixture_subject_with_mixed_CASE_and_a_long_tail_0123456789",
    });
    expect(hits).toEqual([jwksUrlForIssuer(issuer)]);
    const again = await verifyClerkSessionToken(token, config, jwksFetch(key.jwks, hits), now);
    expect(again.ok).toBe(true);
    expect(hits).toHaveLength(1);
  });

  it("rejects type, algorithm, signature, issuer, azp, exp, nbf, and iat", async () => {
    clearClerkJwksCache();
    const key = fixtureKey();
    const fetchImpl = jwksFetch(key.jwks);
    const cases: {
      header?: Record<string, unknown>;
      body?: Record<string, unknown>;
      reason: string;
      raw?: string;
    }[] = [
      { header: { alg: "RS256", typ: "JWT", kid: "fixture-key" }, reason: "session-type" },
      {
        header: { alg: "none", typ: "JWT", kid: "fixture-key", cat: "cl_B7d4PD111AAA" },
        reason: "algorithm",
      },
      { body: { azp: undefined }, reason: "authorized-party" },
      { body: { azp: "https://evil.example" }, reason: "authorized-party" },
      { body: { iss: "https://evil.example" }, reason: "issuer" },
      { body: { exp: Math.floor(now / 1000) - 30 }, reason: "expired" },
      { body: { nbf: Math.floor(now / 1000) + 30 }, reason: "not-before" },
      { body: { iat: Math.floor(now / 1000) + 30 }, reason: "issued-at" },
    ];
    for (const item of cases) {
      const header = item.header ?? {
        alg: "RS256",
        typ: "JWT",
        kid: "fixture-key",
        cat: "cl_B7d4PD111AAA",
      };
      const body: Record<string, unknown> = { ...payload(), ...item.body };
      if (item.body && "azp" in item.body && item.body.azp === undefined) delete body.azp;
      const token = signSessionToken(key.privateKey, body, header);
      const result = await verifyClerkSessionToken(token, config, fetchImpl, now);
      expect(result).toMatchObject({ ok: false, reason: item.reason });
    }
    const signed = signSessionToken(key.privateKey, payload());
    const broken = `${signed.slice(0, -2)}aa`;
    expect(await verifyClerkSessionToken(broken, config, fetchImpl, now)).toMatchObject({
      ok: false,
      reason: "signature",
    });
    const hmac = createHmac("sha256", "secret").update("x").digest("base64url");
    const hs = `${Buffer.from(JSON.stringify({ alg: "HS256", kid: "fixture-key", cat: "cl_B7d4PD111AAA" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload())).toString("base64url")}.${hmac}`;
    expect(await verifyClerkSessionToken(hs, config, fetchImpl, now)).toMatchObject({
      ok: false,
      reason: "algorithm",
    });
  });

  it("does not fetch the issuer written in the token", async () => {
    clearClerkJwksCache();
    const key = fixtureKey();
    const hits: string[] = [];
    const token = signSessionToken(key.privateKey, payload({ iss: "https://evil.example" }));
    const result = await verifyClerkSessionToken(token, config, jwksFetch(key.jwks, hits), now);
    expect(result).toMatchObject({ ok: false, reason: "issuer" });
    expect(hits).toEqual(["https://trusted.example/.well-known/jwks.json"]);
    expect(bearerFromAuthorization("Bearer ")).toBeNull();
    expect(bearerFromAuthorization(null)).toBeNull();
  });

  it("refetches when the key id is new", async () => {
    clearClerkJwksCache();
    const first = fixtureKey("old");
    const second = fixtureKey("fixture-key");
    const hits: string[] = [];
    let generation = 0;
    const fetchImpl: typeof fetch = async (input) => {
      hits.push(String(input));
      generation += 1;
      return new Response(JSON.stringify(generation === 1 ? first.jwks : second.jwks), {
        status: 200,
      });
    };
    const token = signSessionToken(second.privateKey, payload());
    const result = await verifyClerkSessionToken(token, config, fetchImpl, now);
    expect(result.ok).toBe(true);
    expect(hits).toHaveLength(2);
  });
});
