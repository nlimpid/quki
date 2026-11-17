import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readClerkEnv } from "./clerkVerify.js";

describe("site Worker public issuer", () => {
  it("pins CLERK_JWT_ISSUER in the site config only", () => {
    const site = readFileSync("workers/site/wrangler.jsonc", "utf8");
    expect(site).toContain('"CLERK_JWT_ISSUER": "https://clerk.quki.cc"');
    expect(site).not.toContain("keep_vars");
    expect(readClerkEnv({ CLERK_JWT_ISSUER: "https://clerk.quki.cc" })?.issuer).toBe(
      "https://clerk.quki.cc",
    );
    const crawler = readFileSync("workers/crawler/wrangler.jsonc", "utf8");
    expect(crawler).not.toContain("CLERK_JWT_ISSUER");
    expect(crawler).not.toContain("keep_vars");
  });
});
