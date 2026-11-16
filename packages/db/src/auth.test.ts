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
    expect(sql).toContain("UNIQUE KEY uk_auth_users_identity (issuer, subject)");
    expect(sql).toMatch(/issuer\s+VARBINARY\(512\)\s+NOT NULL/);
    expect(sql).toMatch(/subject\s+VARBINARY\(512\)\s+NOT NULL/);
    expect(sql).not.toMatch(/issuer\s+VARCHAR/i);
    expect(sql).not.toMatch(/subject\s+VARCHAR/i);
    expect(sql).not.toContain("provider_subject");
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
    const issuerA = "https://idp.example/realms/a";
    const issuerB = "https://idp.example/realms/b";
    await store.insertUser({
      id: "user-a",
      issuer: issuerA,
      subject,
      displayName: "林",
    });
    await store.insertUser({
      id: "user-b",
      issuer: issuerB,
      subject,
      displayName: null,
    });
    expect(await store.findUser(issuerA, subject)).toEqual({ id: "user-a", displayName: "林" });
    expect(await store.findUser(issuerB, subject)).toEqual({ id: "user-b", displayName: null });
    expect(await store.findUser("https://idp.example/realms/A", subject)).toBeNull();
    expect(await store.findUser(`${issuerA}/`, subject)).toBeNull();
    expect(await store.findUser(`${issuerA} `, subject)).toBeNull();
    expect(await store.findUser(issuerA, `${subject} `)).toBeNull();
    expect(await store.findUser(issuerA, subject.toUpperCase())).toBeNull();
    await store.insertUser({
      id: "user-accent",
      issuer: issuerA,
      subject: "André",
      displayName: null,
    });
    expect(await store.findUser(issuerA, "André")).toEqual({
      id: "user-accent",
      displayName: null,
    });
    expect(await store.findUser(issuerA, "Andre\u0301")).toBeNull();
    await expect(
      store.insertUser({
        id: "user-long",
        issuer: issuerA,
        subject: "x".repeat(513),
        displayName: null,
      }),
    ).rejects.toThrow(/identity_length/);
    expect(await store.findUser(issuerA, "x".repeat(513))).toBeNull();
    await expect(
      store.insertUser({ id: "user-a2", issuer: issuerA, subject, displayName: "再次" }),
    ).rejects.toThrow(/duplicate identity/);
    expect(await store.findUser(issuerA, subject)).toEqual({ id: "user-a", displayName: "林" });
    const subjectBytes = new TextEncoder().encode(subject);
    expect(memory.queries.every((query) => !query.sql.includes(subject))).toBe(true);
    expect(
      memory.queries.some((query) =>
        query.params.some(
          (param) =>
            param instanceof Uint8Array &&
            param.byteLength === subjectBytes.byteLength &&
            param.every((byte, index) => byte === subjectBytes[index]),
        ),
      ),
    ).toBe(true);

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
    const mismatch = await store.claimTransaction("txn-hash", "wrong-state", now);
    expect(mismatch).toEqual({ outcome: "mismatch", returnTo: "/portfolio" });
    const [first, second] = await Promise.all([
      store.claimTransaction("txn-hash", "state-secret", now),
      store.claimTransaction("txn-hash", "state-secret", now),
    ]);
    const claimed = [first, second].filter((result) => result.outcome === "claimed");
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      outcome: "claimed",
      record: { returnTo: "/portfolio", codeVerifier: "verifier-secret" },
    });
    expect([first, second].some((result) => result.outcome === "lost")).toBe(true);
    expect((await store.claimTransaction("txn-hash", "state-secret", now)).outcome).toBe("missing");
    await store.insertTransaction({
      id: "txn-2",
      tokenHash: "txn-old",
      state: "state-secret",
      codeVerifier: "verifier-secret",
      nonce: "nonce-secret",
      returnTo: "/portfolio",
      expiresAt: new Date(now.getTime() - 1_000),
    });
    expect((await store.claimTransaction("txn-old", "state-secret", now)).outcome).toBe("expired");
    expect((await store.claimTransaction("txn-old", "state-secret", now)).outcome).toBe("expired");
  });

  it("fails closed when a stored timestamp cannot be read", () => {
    expect(sessionRecordState(null, null, new Date())).toBe("expired");
    expect(parseSqlDateTime("not-a-date")).toBeNull();
    const parsed = parseSqlDateTime("2026-11-16 00:00:00.000");
    expect(parsed?.toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });
});
