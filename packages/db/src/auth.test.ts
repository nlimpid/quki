import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createAuthStore, parseSqlDateTime, sessionRecordState } from "./auth.js";
import { createAuthMemoryConn } from "./authMemory.js";
import { splitSql } from "./sql.js";

describe("0006_auth.sql", () => {
  const sql = readFileSync(
    new URL("../../../db/migrations/0006_auth.sql", import.meta.url),
    "utf8",
  );

  it("is a new auth schema and does not touch the dividend audit migration", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS auth_users");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS auth_sessions");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS auth_oauth_transactions");
    expect(sql).toContain("NOT APPLIED");
    expect(sql.toLowerCase()).not.toContain("alter table");
    expect(sql.toLowerCase()).not.toContain("dividend_events");
    expect(sql.toLowerCase()).not.toContain("insert into");
    const statements = splitSql(sql);
    expect(
      statements.some((statement) => statement.startsWith("CREATE TABLE IF NOT EXISTS auth_users")),
    ).toBe(true);
    expect(statements.every((statement) => !statement.includes("--"))).toBe(true);
  });
});

describe("auth store", () => {
  it("keeps identifiers in parameters and isolates two users", async () => {
    const memory = createAuthMemoryConn();
    const store = createAuthStore(() => memory);
    const now = new Date("2026-11-16T00:00:00.000Z");
    const subject = "sub' OR provider_subject = 'other";
    await store.insertUser({
      id: "user-a",
      provider: "oidc",
      subject,
      displayName: "林",
    });
    await store.insertUser({
      id: "user-b",
      provider: "oidc",
      subject: "other-person",
      displayName: null,
    });
    expect(await store.findUser("oidc", subject)).toEqual({ id: "user-a", displayName: "林" });
    expect(memory.queries.every((query) => !query.sql.includes(subject))).toBe(true);
    expect(memory.queries.some((query) => query.params.includes(subject))).toBe(true);

    const token = "raw-session-token";
    await store.insertSession({
      id: "session-a",
      userId: "user-a",
      tokenHash: "hash-a",
      csrfToken: "csrf-a",
      expiresAt: new Date(now.getTime() + 60_000),
    });
    await store.insertSession({
      id: "session-b",
      userId: "user-b",
      tokenHash: "hash-b",
      csrfToken: "csrf-b",
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const found = await store.findSession("hash-a", now);
    expect(found).toMatchObject({
      state: "valid",
      user: { id: "user-a", displayName: "林" },
      csrfToken: "csrf-a",
    });
    expect(memory.queries.some((query) => query.sql.includes(token))).toBe(false);

    const expired = await store.findSession("hash-a", new Date(now.getTime() + 120_000));
    expect(expired.state).toBe("expired");
    await store.revokeSession("session-b", now);
    expect((await store.findSession("hash-b", now)).state).toBe("revoked");
  });

  it("returns an oauth transaction once", async () => {
    const store = createAuthStore(() => createAuthMemoryConn());
    const now = new Date("2026-11-16T00:00:00.000Z");
    await store.insertTransaction({
      id: "txn-1",
      tokenHash: "txn-hash",
      state: "state-secret",
      codeVerifier: "verifier-secret",
      nonce: "nonce-secret",
      returnTo: "/portfolio",
      expiresAt: new Date(now.getTime() + 60_000),
    });
    const first = await store.takeTransaction("txn-hash", now);
    expect(first?.returnTo).toBe("/portfolio");
    expect(first?.codeVerifier).toBe("verifier-secret");
    expect(await store.takeTransaction("txn-hash", now)).toBeNull();
    await store.insertTransaction({
      id: "txn-2",
      tokenHash: "txn-old",
      state: "state-secret",
      codeVerifier: "verifier-secret",
      nonce: "nonce-secret",
      returnTo: "/portfolio",
      expiresAt: new Date(now.getTime() - 1_000),
    });
    expect(await store.takeTransaction("txn-old", now)).toBeNull();
    expect(await store.takeTransaction("txn-old", now)).toBeNull();
  });

  it("fails closed when a stored timestamp cannot be read", () => {
    expect(sessionRecordState(null, null, new Date())).toBe("expired");
    expect(parseSqlDateTime("not-a-date")).toBeNull();
    const parsed = parseSqlDateTime("2026-11-16 00:00:00.000");
    expect(parsed?.toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });
});
