import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createCandidateHoldingMemoryConn } from "./holdingMemory.js";
import {
  HOLDING_SHARES_MAX,
  HOLDING_SHARES_MIN,
  HoldingTableMissing,
  createHoldingStore,
  validHoldingVersion,
} from "./holdings.js";

const now = new Date("2026-11-16T00:00:00.000Z");
const versions = [
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "cccccccccccccccccccccccccccccccc",
  "dddddddddddddddddddddddddddddddd",
];

function store(listed = ["600519"]) {
  let index = 0;
  const memory = createCandidateHoldingMemoryConn(listed);
  return createHoldingStore(() => memory, {
    newVersion: () => versions[index++] ?? "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  });
}

describe("candidate fake database, not TiDB", () => {
  it("names 0008 so it does not replace 0006 or the unmerged 0007 file", () => {
    const names = readdirSync(new URL("../../../db/migrations", import.meta.url));
    expect(names).toContain("0006_auth.sql");
    expect(names).not.toContain("0007_holdings.sql");
    expect(names).toContain("0008_auth_holdings.sql");
    const sql = readFileSync(
      new URL("../../../db/migrations/0008_auth_holdings.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("PRIMARY KEY (user_id, code)");
    expect(sql).not.toContain("KEY idx_");
    expect(sql.slice(sql.indexOf("CREATE TABLE"))).not.toContain("auth_user_books");
    expect(sql).toContain(`shares >= ${HOLDING_SHARES_MIN} AND shares <= ${HOLDING_SHARES_MAX}`);
    expect(sql.slice(sql.indexOf("CREATE TABLE"))).toContain("version    CHAR(32)");
    expect(sql.slice(sql.indexOf("CREATE TABLE"))).not.toContain("BIGINT");
  });

  it("rejects a code that is only six digits and a share count outside the check", async () => {
    const holdings = store();
    expect(await holdings.create({ userId: "user-a", code: "000001", shares: 10, now })).toEqual({
      ok: false,
      reason: "unknown_code",
    });
    expect(await holdings.create({ userId: "user-a", code: "600519", shares: 0, now })).toEqual({
      ok: false,
      reason: "invalid_shares",
    });
    expect(
      await holdings.create({
        userId: "user-a",
        code: "600519",
        shares: HOLDING_SHARES_MAX + 1,
        now,
      }),
    ).toEqual({ ok: false, reason: "invalid_shares" });
    expect(validHoldingVersion(1)).toBe(false);
  });

  it("lets one of two creates win and one of two updates win", async () => {
    const holdings = store();
    const [first, second] = await Promise.all([
      holdings.create({ userId: "user-a", code: "600519", shares: 100, now }),
      holdings.create({ userId: "user-a", code: "600519", shares: 200, now }),
    ]);
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect([first, second].some((result) => !result.ok && result.reason === "conflict")).toBe(true);
    const listed = await holdings.list("user-a");
    expect(listed).toHaveLength(1);
    const version = listed[0]?.version ?? "";
    const [left, right] = await Promise.all([
      holdings.update({
        userId: "user-a",
        code: "600519",
        shares: 300,
        expectedVersion: version,
        now,
      }),
      holdings.update({
        userId: "user-a",
        code: "600519",
        shares: 400,
        expectedVersion: version,
        now,
      }),
    ]);
    expect([left, right].filter((result) => result.ok)).toHaveLength(1);
    const after = await holdings.list("user-a");
    expect(after).toHaveLength(1);
    expect([300, 400]).toContain(after[0]?.shares);
    const removed = await Promise.all([
      holdings.remove({
        userId: "user-a",
        code: "600519",
        expectedVersion: after[0]?.version ?? "",
      }),
      holdings.remove({
        userId: "user-a",
        code: "600519",
        expectedVersion: after[0]?.version ?? "",
      }),
    ]);
    expect(removed.filter((result) => result.ok)).toHaveLength(1);
    expect(await holdings.list("user-a")).toEqual([]);
  });

  it("does not let a deleted version update the row that replaced it", async () => {
    const holdings = store();
    const created = await holdings.create({ userId: "user-a", code: "600519", shares: 100, now });
    if (!created.ok) throw new Error("create");
    expect(
      await holdings.remove({
        userId: "user-a",
        code: "600519",
        expectedVersion: created.row.version,
      }),
    ).toEqual({ ok: true });
    const again = await holdings.create({ userId: "user-a", code: "600519", shares: 50, now });
    if (!again.ok) throw new Error("recreate");
    expect(again.row.version).not.toBe(created.row.version);
    expect(
      await holdings.update({
        userId: "user-a",
        code: "600519",
        shares: 999,
        expectedVersion: created.row.version,
        now,
      }),
    ).toEqual({ ok: false, reason: "conflict" });
    expect(await holdings.list("user-a")).toEqual([again.row]);
  });

  it("keeps one account from writing the other account's row", async () => {
    const holdings = store();
    const created = await holdings.create({ userId: "user-a", code: "600519", shares: 100, now });
    if (!created.ok) throw new Error("create");
    expect(
      await holdings.update({
        userId: "user-b",
        code: "600519",
        shares: 1,
        expectedVersion: created.row.version,
        now,
      }),
    ).toEqual({ ok: false, reason: "conflict" });
    expect(await holdings.list("user-b")).toEqual([]);
    expect(await holdings.list("user-a")).toEqual([created.row]);
    const other = await holdings.create({ userId: "user-b", code: "600519", shares: 8, now });
    if (!other.ok) throw new Error("other");
    expect(await holdings.list("user-a")).toEqual([created.row]);
    expect((await holdings.list("user-b"))[0]?.shares).toBe(8);
  });

  it("reports a missing table instead of an empty book", async () => {
    const holdings = createHoldingStore(() => ({
      async execute() {
        throw new Error("Table 'quki.auth_holdings' doesn't exist");
      },
    }));
    await expect(holdings.list("user-a")).rejects.toBeInstanceOf(HoldingTableMissing);
  });
});
