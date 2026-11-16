import { connect } from "@tidbcloud/serverless";
import { describe, expect, it } from "vitest";

import { createAuthStore, identityKey, rowsAffectedOf } from "./auth.js";
import type { SqlConn } from "./client.js";

function hexLiteral(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

type FetchMock = (
  input: string,
  init?: { method?: string; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

function driverFetch(payload: Record<string, unknown>, queries: string[]): FetchMock {
  return async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
    if (body.query) queries.push(body.query);
    if (!String(input).startsWith("https://http-gateway.example/v1beta/sql")) {
      throw new Error("driver attempted an unexpected host");
    }
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: {
        get(name: string) {
          return name.toLowerCase() === "tidb-session" ? "offline-session" : null;
        },
      },
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    };
  };
}

async function decodeDelete(rowsAffected: unknown): Promise<unknown> {
  const conn = connect({
    url: "mysql://ci:example-password@gateway.example:4000/quki_ci",
    fullResult: true,
    fetch: driverFetch({ types: [], rows: [], rowsAffected }, []),
  });
  return conn.execute("DELETE FROM auth_oauth_transactions WHERE token_hash = ?", [
    new TextEncoder().encode("token"),
  ]);
}

describe("identity bytes sent by the HTTP driver", () => {
  it("binds issuer and subject as distinct hex literals, including case and trailing bytes", async () => {
    const queries: string[] = [];
    const conn = connect({
      url: "mysql://ci:example-password@gateway.example:4000/quki_ci",
      fullResult: true,
      fetch: driverFetch({ types: [], rows: [], rowsAffected: 0 }, queries),
    });
    const issuer = "https://IDP.example/realms/a";
    const subject = "Sub ";
    await conn.execute(
      "SELECT id, display_name FROM auth_users WHERE issuer = ? AND subject = ? LIMIT 1",
      [identityKey(issuer), identityKey(subject)],
    );
    const sql = queries[0] ?? "";
    expect(sql).toContain(`issuer = ${hexLiteral(issuer)}`);
    expect(sql).toContain(`subject = ${hexLiteral(subject)}`);
    expect(sql).not.toContain(`issuer = ${hexLiteral(issuer.toLowerCase())}`);
    expect(sql).toContain(`subject = ${hexLiteral(subject)} LIMIT 1`);
    expect(hexLiteral("https://idp.example/a")).not.toBe(hexLiteral("https://idp.example/a "));
    expect(hexLiteral("André")).not.toBe(hexLiteral("Andre\u0301"));
    expect(sql).not.toContain(issuer);
    expect(sql).not.toContain("example-password");
  });
});

describe("serverless rowsAffected decoding", () => {
  it("accepts only a numeric 1 as a delete winner", async () => {
    const one = await decodeDelete(1);
    expect(one).toMatchObject({ rowsAffected: 1, rows: [] });
    expect(rowsAffectedOf(one)).toBe(1);

    expect(rowsAffectedOf(await decodeDelete(0))).toBe(0);
    expect(await decodeDelete(undefined)).toMatchObject({ rowsAffected: null });
    expect(rowsAffectedOf(await decodeDelete(undefined))).toBe(0);
    expect(await decodeDelete("1")).toMatchObject({ rowsAffected: "1" });
    expect(rowsAffectedOf(await decodeDelete("1"))).toBe(0);
    expect(rowsAffectedOf([])).toBe(0);
    expect(rowsAffectedOf({ rows: [] })).toBe(0);

    const now = new Date("2026-11-16T00:00:00.000Z");
    const row = {
      id: "txn-1",
      state_secret: "state-secret",
      code_verifier: "verifier-secret",
      nonce: "nonce-secret",
      return_to: "/portfolio",
      expires_at: "2026-11-16 00:10:00.000",
    };
    const responses = [one, await decodeDelete(0), await decodeDelete("1")];
    let deletes = 0;
    const scripted: SqlConn = {
      async execute(sql: string) {
        if (sql.includes("SELECT id, state_secret")) return { rows: [row] };
        if (sql.startsWith("DELETE")) return responses[deletes++] ?? { rowsAffected: 0 };
        throw new Error(`unexpected sql: ${sql}`);
      },
    };
    const store = createAuthStore(() => scripted);
    expect((await store.claimTransaction("hash", "state-secret", now)).outcome).toBe("claimed");
    expect((await store.claimTransaction("hash", "state-secret", now)).outcome).toBe("lost");
    expect((await store.claimTransaction("hash", "state-secret", now)).outcome).toBe("lost");
  });
});
