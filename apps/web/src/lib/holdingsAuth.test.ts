import { HOLDINGS_STORAGE_KEY, type HoldingsState } from "@quki/analytics";
import { describe, expect, it } from "vitest";

import { visibleAccountHoldings } from "./accountHoldings.js";
import {
  bearerForUser,
  bearerHeader,
  fetchSession,
  logoutSession,
  SessionRejectedError,
} from "./authClient.js";
import { writeAccountHoldings } from "./accountHoldings.js";
import { readHoldings, writeHoldings } from "./holdingsStore.js";

const sample: HoldingsState = {
  version: 1,
  items: [{ code: "600519", shares: 100, updatedAt: "2026-11-16T00:00:00.000Z" }],
};

function installStorage(): Map<string, string> {
  const saved = new Map<string, string>();
  const storage = {
    get length() {
      return saved.size;
    },
    clear() {
      saved.clear();
    },
    getItem(key: string) {
      return saved.get(key) ?? null;
    },
    key(index: number) {
      return [...saved.keys()][index] ?? null;
    },
    removeItem(key: string) {
      saved.delete(key);
    },
    setItem(key: string, value: string) {
      saved.set(key, value);
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  return saved;
}

describe("holdings stay on this browser", () => {
  it("does not read or write qk.holdings.v1 during session probe or logout", async () => {
    const saved = installStorage();
    writeHoldings(sample);
    const before = saved.get(HOLDINGS_STORAGE_KEY);
    const reads: string[] = [];
    const original = globalThis.localStorage.getItem.bind(globalThis.localStorage);
    globalThis.localStorage.getItem = (key: string) => {
      reads.push(key);
      return original(key);
    };
    await fetchSession(async () =>
      Response.json({
        status: "anonymous",
        authenticated: false,
        expired: true,
        user: null,
        csrfToken: null,
        login: { ready: true, method: "clerk", reason: null },
      }),
    );
    await logoutSession("labelled-token", async () => new Response(null, { status: 204 }));
    await expect(
      logoutSession(null, async () => new Response(null, { status: 204 })),
    ).rejects.toThrow(/logout_failed/);
    await expect(
      logoutSession("labelled-token", async () => new Response("no", { status: 503 })),
    ).rejects.toThrow(/logout_failed/);
    await expect(
      fetchSession(
        async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
        "rejected-jwt",
      ),
    ).rejects.toBeInstanceOf(SessionRejectedError);
    expect(saved.get(HOLDINGS_STORAGE_KEY)).toBe(before);
    expect(reads.filter((key) => key === HOLDINGS_STORAGE_KEY)).toEqual([]);
    expect(readHoldings().state).toEqual(sample);
  });

  it("clears the account list on logout and leaves the browser book", () => {
    const account = [
      {
        code: "600519",
        shares: 100,
        updatedAt: "2026-11-16 00:00:00.000",
        version: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ];
    expect(bearerHeader(null)).toEqual({});
    expect(bearerHeader("")).toEqual({});
    expect(bearerHeader("jwt")).toEqual({ authorization: "Bearer jwt" });
    expect(bearerForUser("user-a", "user-a", "jwt")).toBe("jwt");
    expect(bearerForUser("user-a", "user-b", "jwt")).toBeNull();
    expect(bearerForUser(null, "user-a", "jwt")).toBeNull();
    expect(bearerForUser("user-a", "user-a", "")).toBeNull();
    expect(visibleAccountHoldings(false, account)).toBeNull();
    expect(visibleAccountHoldings(true, account)).toEqual(account);
  });

  it("sends the Clerk bearer on an account holding write", async () => {
    const seen: { authorization: string | null; csrf: string | null; body: string }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input, init) => {
      const headers = new Headers(init?.headers);
      seen.push({
        authorization: headers.get("authorization"),
        csrf: headers.get("x-csrf-token"),
        body: typeof init?.body === "string" ? init.body : "",
      });
      return Response.json({ code: "600519", shares: 10, version: "a".repeat(32) });
    }) as typeof fetch;
    try {
      await writeAccountHoldings(
        { code: "600519", shares: 10, expectedVersion: null },
        "session-jwt",
      );
    } finally {
      globalThis.fetch = original;
    }
    expect(seen).toEqual([
      {
        authorization: "Bearer session-jwt",
        csrf: null,
        body: JSON.stringify({ code: "600519", shares: 10, expectedVersion: null }),
      },
    ]);
    await expect(
      writeAccountHoldings({ code: "600519", shares: 10, expectedVersion: null }, null),
    ).rejects.toThrow(/需要登录/);
  });
});
