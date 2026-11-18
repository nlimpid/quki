import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ownedCacheNamesToDelete, planFetch, PRECACHE_PATHS } from "./cachePolicy.js";

const origin = "https://quki.cc";

describe("service worker cache policy", () => {
  it("allows only the static install files", () => {
    for (const path of PRECACHE_PATHS) {
      expect(planFetch({ url: `${origin}${path}`, method: "GET" })).toBe("precache");
    }
  });

  it("never caches auth, account, holdings, or other API calls", () => {
    const urls = [
      "/api/auth",
      "/api/auth/session",
      "/api/auth/session?return=1",
      "/api/account",
      "/api/account/profile?x=1",
      "/api/holdings",
      "/api/holdings/000001",
      "/api/holdings?user=a",
      "/api/stocks/batch",
      "/api/stocks?q=000001",
    ];
    for (const path of urls) {
      for (const method of ["GET", "POST", "PUT", "DELETE", "HEAD"]) {
        expect(planFetch({ url: `${origin}${path}`, method })).toBe("network-only");
      }
    }
  });

  it("leaves third-party Clerk and OTP hosts on the network", () => {
    const hosts = [
      "https://clerk.quki.cc/.well-known/jwks.json",
      "https://happy-horse-1.clerk.accounts.dev/v1/client",
      "https://api.clerk.com/v1/me",
    ];
    for (const url of hosts) {
      expect(planFetch({ url, method: "GET" })).toBe("network-only");
      expect(planFetch({ url, method: "POST" })).toBe("network-only");
    }
  });

  it("uses the offline page for a failed navigation and does not treat it as a stored account page", () => {
    expect(planFetch({ url: `${origin}/portfolio`, method: "GET", mode: "navigate" })).toBe(
      "navigation-or-offline",
    );
    expect(planFetch({ url: `${origin}/portfolio?add=1`, method: "GET", mode: "navigate" })).toBe(
      "navigation-or-offline",
    );
    expect(planFetch({ url: `${origin}/`, method: "POST", mode: "navigate" })).toBe("network-only");
  });

  it("does not write runtime responses or delete unrelated caches", () => {
    const source = readFileSync("apps/web/src/pwa/sw.ts", "utf8");
    expect(source).not.toContain("cache.put");
    expect(source).not.toContain("caches.delete()");
    expect(source).toContain("ownedCacheNamesToDelete");
    expect(source).toContain('"/offline.html"');
  });

  it("deletes only older caches with the owned prefix", () => {
    expect(ownedCacheNamesToDelete(["quki-pwa-static-v0", "quki-pwa-static-v1", "other-app"])).toEqual([
      "quki-pwa-static-v0",
    ]);
  });
});
