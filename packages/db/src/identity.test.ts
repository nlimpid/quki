import { describe, expect, it } from "vitest";

import { createIdentityStore } from "./identity.js";
import { createIdentityMemoryConn } from "./identityMemory.js";

const issuer = "https://trusted.example";
const subject = `user_${"Ab".repeat(40)} `;

describe("identity map on a fake database, not TiDB", () => {
  it("keeps a long subject byte for byte and does not store email", async () => {
    const memory = createIdentityMemoryConn();
    const store = createIdentityStore(() => memory);
    const id = await store.resolve(issuer, subject);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new TextDecoder().decode(memory.rows[0]?.subject)).toBe(subject);
    expect(await store.resolve(issuer, subject.trimEnd())).not.toBe(id);
    const sql = "INSERT INTO auth_identities (id, issuer, subject, created_at) VALUES (?, ?, ?, ?)";
    expect(sql.toLowerCase()).not.toContain("email");
  });

  it("returns the existing uuid when two first writes race", async () => {
    const memory = createIdentityMemoryConn();
    const store = createIdentityStore(() => memory);
    const [left, right] = await Promise.all([
      store.resolve(issuer, subject),
      store.resolve(issuer, subject),
    ]);
    expect(left).toBe(right);
    expect(memory.rows.map((row) => row.id)).toEqual([left]);
    expect(await store.resolve(issuer, subject)).toBe(left);
  });

  it("does not keep the losing uuid after a duplicate insert", async () => {
    const memory = createIdentityMemoryConn();
    const winner = "11111111-1111-4111-8111-111111111111";
    memory.rows.push({
      id: winner,
      issuer: new TextEncoder().encode(issuer),
      subject: new TextEncoder().encode(subject),
    });
    const store = createIdentityStore(() => memory);
    expect(await store.resolve(issuer, subject)).toBe(winner);
    expect(memory.rows).toHaveLength(1);
  });
});
