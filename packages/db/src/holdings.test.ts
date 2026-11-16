import { describe, expect, it } from "vitest";

import type { SqlConn } from "./client.js";
import {
  createHoldingsStore,
  lookupHoldingCash,
  MAX_LIVE_APPLIES,
  OPERATION_RETENTION_MS,
  parseBookDocument,
  planBookChange,
} from "./holdings.js";
import { createHoldingsMemory } from "./holdingsMemory.js";

const now = new Date("2026-11-16T00:00:00.000Z");

function op(n: number, at = now): string {
  return `op.v1.${String(at.getTime()).padStart(13, "0")}.00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

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
          key: op(1),
          hash: "a".repeat(64),
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
        key: op(2),
        hash: "b".repeat(64),
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

describe("stored book schema", () => {
  it("rejects a parseable document that is not the book schema and does not write it", async () => {
    const valid = {
      items: [{ code: "000001", shares: 1, updatedAt: now.toISOString() }],
      applies: {},
      drafts: {},
      attempts: [],
    };
    expect(parseBookDocument(JSON.stringify(valid)).items).toEqual(valid.items);
    const broken = [
      JSON.stringify({ ...valid, items: { code: "000001" } }),
      JSON.stringify({ ...valid, applies: [] }),
      JSON.stringify({ ...valid, drafts: [] }),
      JSON.stringify({ ...valid, attempts: {} }),
      JSON.stringify({
        ...valid,
        items: [{ code: "000001", shares: "1", updatedAt: now.toISOString() }],
      }),
      JSON.stringify({
        ...valid,
        items: [{ code: "00001", shares: 1, updatedAt: now.toISOString() }],
      }),
      JSON.stringify({
        ...valid,
        items: [{ code: "000001", shares: 1.5, updatedAt: now.toISOString() }],
      }),
      JSON.stringify({
        ...valid,
        applies: { "not-a-token": { hash: "a".repeat(64), expiresAt: now.toISOString(), items: [] } },
      }),
      JSON.stringify({
        ...valid,
        drafts: { short: { payload: "[]", expiresAt: now.toISOString(), consumedBy: 1 } },
      }),
      JSON.stringify({
        ...valid,
        attempts: [{ id: "attempt", at: "yesterday", status: "finished" }],
      }),
      "{",
      "null",
      "[]",
    ];
    for (const document of broken) expect(() => parseBookDocument(document)).toThrow(/book_corrupt/);
    const versions: unknown[] = ["01", "1.0", "1e2", 1.5, 0, -1];
    for (const version of versions) {
      const calls: string[] = [];
      const conn: SqlConn = {
        async execute(sql: string) {
          calls.push(sql);
          if (sql.startsWith("SELECT version, document")) {
            return { rows: [{ version, document: JSON.stringify(valid) }] };
          }
          return { rows: [], rowsAffected: 1 };
        },
      };
      const store = createHoldingsStore(() => conn);
      await expect(store.list("user-a")).rejects.toThrow(/book_corrupt/);
      await expect(
        store.commit({
          userId: "user-a",
          key: op(1),
          hash: "a".repeat(64),
          mode: "replace",
          lines: [],
          now,
        }),
      ).rejects.toThrow(/book_corrupt/);
      expect(calls.some((sql) => sql.startsWith("UPDATE") || sql.startsWith("INSERT"))).toBe(false);
    }
  });
});

describe("book plan", () => {
  it("replays the stored result and refuses a consumed draft", () => {
    const first = planBookChange(
      { items: [], applies: {}, drafts: {}, attempts: [] },
      {
        key: op(1),
        hash: "a".repeat(64),
        mode: "replace",
        lines: [{ code: "000001", shares: 100, updatedAt: now.toISOString() }],
        now,
      },
    );
    if (!first.doc) throw new Error("expected a write");
    const second = planBookChange(first.doc, {
      key: op(2),
      hash: "b".repeat(64),
      mode: "replace",
      lines: [{ code: "000001", shares: 200, updatedAt: now.toISOString() }],
      now,
    });
    if (!second.doc) throw new Error("expected a newer write");
    const replay = planBookChange(second.doc, {
      key: op(1),
      hash: "a".repeat(64),
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
        key: op(3),
        hash: "c".repeat(64),
        mode: "apply",
        draftId: "draft",
        lines: [{ code: "000001", shares: 100, updatedAt: now.toISOString() }],
        now,
      },
    );
    expect(withDraft).toEqual({ doc: null, result: { outcome: "draft_used" } });
  });

  it("keeps at most the live window across a long series of saves", () => {
    let doc: Parameters<typeof planBookChange>[0] = {
      items: [],
      applies: {},
      drafts: {},
      attempts: [],
    };
    let clock = now;
    const many = Array.from({ length: 50 }, (_, index) => ({
      code: String(index).padStart(6, "0"),
      shares: index + 1,
      updatedAt: now.toISOString(),
    }));
    for (let index = 1; index <= 40; index += 1) {
      if (index > MAX_LIVE_APPLIES && (index - 1) % MAX_LIVE_APPLIES === 0) {
        clock = new Date(clock.getTime() + OPERATION_RETENTION_MS + 1);
      }
      const lines = many.map((line) => ({ ...line, updatedAt: clock.toISOString() }));
      const planned = planBookChange(doc, {
        key: op(index, clock),
        hash: index.toString(16).padStart(64, "b"),
        mode: "replace",
        lines,
        now: clock,
      });
      expect(planned.result.outcome).toBe("written");
      if (!planned.doc) throw new Error("expected the next book");
      expect(Object.keys(planned.doc.applies).length).toBeLessThanOrEqual(MAX_LIVE_APPLIES);
      expect(JSON.stringify(planned.doc).length).toBeLessThanOrEqual(48_000);
      doc = planned.doc;
    }
    expect(doc.items).toHaveLength(50);
    const edge = new Date(clock.getTime() + OPERATION_RETENTION_MS);
    const replay = planBookChange(doc, {
      key: op(40, clock),
      hash: (40).toString(16).padStart(64, "b"),
      mode: "replace",
      lines: doc.items,
      now: edge,
    });
    expect(replay.result.outcome).toBe("replay");
    expect(replay.doc).toBeNull();
    const past = new Date(edge.getTime() + 1);
    const expired = planBookChange(doc, {
      key: op(40, clock),
      hash: (40).toString(16).padStart(64, "b"),
      mode: "replace",
      lines: [{ code: "000001", shares: 9, updatedAt: past.toISOString() }],
      now: past,
    });
    expect(expired.result).toEqual({ outcome: "expired" });
    expect(expired.doc?.items ?? doc.items).toEqual(doc.items);
  });
});

describe("holdings memory stand-in", () => {
  it("sets an exact quantity without a second add", async () => {
    const store = createHoldingsMemory();
    await store.commit({
      userId: "user-a",
      key: op(1),
      hash: "a".repeat(64),
      mode: "replace",
      lines: [{ code: "000001", shares: 100, updatedAt: now.toISOString() }],
      now,
    });
    await store.commit({
      userId: "user-a",
      key: op(2),
      hash: "b".repeat(64),
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

  it("keeps a bounded replay window and refuses an expired key after reclaiming it", async () => {
    const store = createHoldingsMemory();
    const line = (shares: number, at = now) => ({
      code: "000001",
      shares,
      updatedAt: at.toISOString(),
    });
    for (let index = 1; index <= MAX_LIVE_APPLIES; index += 1) {
      const written = await store.commit({
        userId: "user-a",
        key: op(index),
        hash: index.toString(16).padStart(64, "a"),
        mode: "replace",
        lines: [line(index)],
        now,
      });
      expect(written.outcome).toBe("written");
    }
    const blocked = await store.commit({
      userId: "user-a",
      key: op(MAX_LIVE_APPLIES + 1),
      hash: "c".repeat(64),
      mode: "replace",
      lines: [],
      now,
    });
    expect(blocked).toEqual({ outcome: "window_full" });
    expect(await store.list("user-a")).toEqual([line(MAX_LIVE_APPLIES)]);
    const later = new Date(now.getTime() + OPERATION_RETENTION_MS + 1);
    const expired = await store.commit({
      userId: "user-a",
      key: op(1),
      hash: "1".padStart(64, "a"),
      mode: "replace",
      lines: [line(1, later)],
      now: later,
    });
    expect(expired).toEqual({ outcome: "expired" });
    expect(await store.list("user-a")).toEqual([line(MAX_LIVE_APPLIES)]);
    const cleared = await store.commit({
      userId: "user-a",
      key: op(20, later),
      hash: "d".repeat(64),
      mode: "replace",
      lines: [],
      now: later,
    });
    expect(cleared.outcome).toBe("written");
    expect(await store.list("user-a")).toEqual([]);
    const restored = await store.commit({
      userId: "user-a",
      key: op(21, later),
      hash: "e".repeat(64),
      mode: "set",
      lines: [line(1, later)],
      now: later,
    });
    expect(restored.outcome).toBe("written");
    expect(await store.list("user-a")).toEqual([line(1, later)]);
  });

  it("does not let a paused prune write over a newer book", async () => {
    const store = createHoldingsMemory();
    const line = (shares: number) => ({
      code: "000001",
      shares,
      updatedAt: now.toISOString(),
    });
    await store.commit({
      userId: "user-a",
      key: op(1),
      hash: "a".repeat(64),
      mode: "replace",
      lines: [line(100)],
      now,
    });
    const later = new Date(now.getTime() + OPERATION_RETENTION_MS + 1);
    store.pauseNext = true;
    let release: () => void = () => undefined;
    store.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const enteredBefore = store.entered;
    const stale = store.commit({
      userId: "user-a",
      key: op(1),
      hash: "a".repeat(64),
      mode: "replace",
      lines: [line(1)],
      now: later,
    });
    for (let wait = 0; store.entered === enteredBefore && wait < 20; wait += 1) await Promise.resolve();
    expect(store.entered).toBe(enteredBefore + 1);
    const fresh = await store.commit({
      userId: "user-a",
      key: op(2, later),
      hash: "b".repeat(64),
      mode: "replace",
      lines: [{ ...line(200), updatedAt: later.toISOString() }],
      now: later,
    });
    release();
    await expect(stale).resolves.toEqual({ outcome: "expired" });
    expect(fresh.outcome).toBe("written");
    expect(await store.list("user-a")).toEqual([{ code: "000001", shares: 200, updatedAt: later.toISOString() }]);
  });

  it("reclaims expired drafts and attempts without resurrecting a consumed draft", async () => {
    const store = createHoldingsMemory();
    const draftId = "11111111-1111-4111-8111-111111111111";
    const otherId = "22222222-2222-4222-8222-222222222222";
    const thirdId = "33333333-3333-4333-8333-333333333333";
    await store.insertDraft({
      id: draftId,
      userId: "user-a",
      payloadJson: "[]",
      expiresAt: new Date(now.getTime() + 60_000),
      now,
    });
    await store.insertDraft({
      id: otherId,
      userId: "user-a",
      payloadJson: "[]",
      expiresAt: new Date(now.getTime() + 60_000),
      now,
    });
    await expect(
      store.insertDraft({
        id: thirdId,
        userId: "user-a",
        payloadJson: "[]",
        expiresAt: new Date(now.getTime() + 60_000),
        now,
      }),
    ).rejects.toThrow(/window_full/);
    const first = await store.commit({
      userId: "user-a",
      key: op(1),
      hash: "a".repeat(64),
      mode: "apply",
      draftId,
      lines: [{ code: "000001", shares: 100, updatedAt: now.toISOString() }],
      now,
    });
    expect(first.outcome).toBe("written");
    const reused = await store.commit({
      userId: "user-a",
      key: op(2),
      hash: "b".repeat(64),
      mode: "apply",
      draftId,
      lines: [{ code: "000001", shares: 50, updatedAt: now.toISOString() }],
      now,
    });
    expect(reused).toEqual({ outcome: "draft_used" });
    expect(await store.list("user-a")).toEqual([
      { code: "000001", shares: 100, updatedAt: now.toISOString() },
    ]);
    const later = new Date(now.getTime() + OPERATION_RETENTION_MS + 1);
    const resurrected = await store.commit({
      userId: "user-a",
      key: op(3, later),
      hash: "c".repeat(64),
      mode: "apply",
      draftId,
      lines: [{ code: "000001", shares: 9, updatedAt: later.toISOString() }],
      now: later,
    });
    expect(resurrected).toEqual({ outcome: "draft_missing" });
    expect(await store.list("user-a")).toEqual([
      { code: "000001", shares: 100, updatedAt: now.toISOString() },
    ]);
    await store.insertDraft({
      id: thirdId,
      userId: "user-a",
      payloadJson: "[]",
      expiresAt: new Date(later.getTime() + 60_000),
      now: later,
    });
    expect(await store.readDraft("user-a", draftId, later)).toBe("missing");
    for (let index = 0; index < 3; index += 1) {
      expect(await store.reserveAttempt("user-a", now, 5, OPERATION_RETENTION_MS)).not.toBe("limited");
    }
    const reserved = await store.reserveAttempt("user-a", later, 5, OPERATION_RETENTION_MS);
    expect(reserved).toEqual(expect.objectContaining({ id: expect.any(String) }));
    expect(store.attempts).toHaveLength(1);
  });
});
