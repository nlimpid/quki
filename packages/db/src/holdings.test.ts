import { describe, expect, it } from "vitest";

import type { SqlConn } from "./client.js";
import { createHoldingsStore, lookupHoldingCash, planBookChange } from "./holdings.js";
import { createHoldingsMemory } from "./holdingsMemory.js";

const now = new Date("2026-11-16T00:00:00.000Z");

describe("versioned book sql", () => {
  it("keeps the previous document when the single update fails", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    let version = 0;
    let document = "";
    let failNext = false;
    const conn: SqlConn = {
      async execute(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        if (sql.includes("CAST(ttm_cash_per_share AS CHAR)")) {
          return {
            rows: [{ code: "000001", name: "平安银行", ttm_cash: "0.25", yield_as_of: "2026-11-14" }],
          };
        }
        if (sql.startsWith("SELECT version, document")) {
          return version === 0 ? { rows: [] } : { rows: [{ version, document }] };
        }
        if (sql.startsWith("INSERT INTO auth_user_books") || sql.startsWith("UPDATE auth_user_books")) {
          if (failNext) {
            failNext = false;
            throw new Error("injected_write_failure");
          }
          version = sql.startsWith("INSERT") ? 1 : Number(params[0]);
          document = String(sql.startsWith("INSERT") ? params[1] : params[1]);
          return { rows: [], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 1 };
      },
    };
    const store = createHoldingsStore(() => conn);
    const line = (shares: number) => ({ code: "000001", shares, updatedAt: now.toISOString() });
    expect(
      (
        await store.commit({
          userId: "user-a",
          key: "11111111-1111-4111-8111-111111111111",
          hash: "hash-40",
          mode: "replace",
          lines: [line(40)],
          now,
        })
      ).outcome,
    ).toBe("written");
    failNext = true;
    await expect(
      store.commit({
        userId: "user-a",
        key: "22222222-2222-4222-8222-222222222222",
        hash: "hash-split",
        mode: "replace",
        lines: [line(1), { code: "600519", shares: 2, updatedAt: now.toISOString() }],
        now,
      }),
    ).rejects.toThrow(/injected_write_failure/);
    expect(await store.list("user-a")).toEqual([line(40)]);
    expect(calls.some((call) => call.sql.includes("DELETE FROM"))).toBe(false);
    expect(calls.some((call) => call.sql.includes("BEGIN"))).toBe(false);
    const quotes = await lookupHoldingCash(conn, ["000001", "000001' OR '1'='1"]);
    expect(calls.at(-1)?.params).toEqual(["000001"]);
    expect(quotes[0]?.name).toBe("平安银行");
  });
});

describe("book plan", () => {
  it("replays the stored result and refuses a consumed draft", () => {
    const first = planBookChange(
      { items: [], applies: {}, drafts: {}, attempts: [] },
      {
        key: "key-a",
        hash: "hash-100",
        mode: "replace",
        lines: [{ code: "000001", shares: 100, updatedAt: now.toISOString() }],
        now,
      },
    );
    if (!first.doc) throw new Error("expected a write");
    const second = planBookChange(first.doc, {
      key: "key-b",
      hash: "hash-200",
      mode: "replace",
      lines: [{ code: "000001", shares: 200, updatedAt: now.toISOString() }],
      now,
    });
    if (!second.doc) throw new Error("expected a newer write");
    const replay = planBookChange(second.doc, {
      key: "key-a",
      hash: "hash-100",
      mode: "replace",
      lines: [{ code: "000001", shares: 100, updatedAt: now.toISOString() }],
      now,
    });
    expect(replay.doc).toBeNull();
    expect(replay.result).toMatchObject({ outcome: "replay", items: [expect.objectContaining({ shares: 100 })] });
    expect(second.doc.items).toEqual([expect.objectContaining({ shares: 200 })]);
    const withDraft = planBookChange(
      { items: [], applies: {}, drafts: { draft: { payload: "[]", expiresAt: "2026-11-16T00:10:00.000Z", consumedBy: "key-a" } }, attempts: [] },
      {
        key: "key-c",
        hash: "hash-new",
        mode: "apply",
        draftId: "draft",
        lines: [{ code: "000001", shares: 100, updatedAt: now.toISOString() }],
        now,
      },
    );
    expect(withDraft).toEqual({ doc: null, result: { outcome: "draft_used" } });
  });
});

describe("holdings memory stand-in", () => {
  it("sets an exact quantity without a second add", async () => {
    const store = createHoldingsMemory();
    await store.commit({
      userId: "user-a",
      key: "key-1",
      hash: "h1",
      mode: "replace",
      lines: [{ code: "000001", shares: 100, updatedAt: now.toISOString() }],
      now,
    });
    await store.commit({
      userId: "user-a",
      key: "key-2",
      hash: "h2",
      mode: "set",
      lines: [
        { code: "000001", shares: 40, updatedAt: now.toISOString() },
        { code: "600519", shares: 10, updatedAt: now.toISOString() },
      ],
      now,
    });
    expect(await store.list("user-a")).toEqual([
      { code: "000001", shares: 40, updatedAt: now.toISOString() },
      { code: "600519", shares: 10, updatedAt: now.toISOString() },
    ]);
    expect(await store.list("user-b")).toEqual([]);
    expect(store.commits).toBe(2);
  });
});
