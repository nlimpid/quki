import { describe, expect, it } from "vitest";

import { accountLabel, parseAuthSessionResponse, publicDisplayName, safeReturnTo } from "./auth.js";

const origin = "https://quki.cc";

describe("safeReturnTo", () => {
  it("keeps same-origin path and search and drops the hash", () => {
    expect(safeReturnTo("/portfolio", origin)).toBe("/portfolio");
    expect(safeReturnTo("/portfolio?edit=1", origin)).toBe("/portfolio?edit=1");
    expect(safeReturnTo("/index/H30269?period=W&range=5Y", origin)).toBe(
      "/index/H30269?period=W&range=5Y",
    );
    expect(safeReturnTo("/portfolio?edit=1#secret", origin)).toBe("/portfolio?edit=1");
    expect(safeReturnTo("/", origin)).toBe("/");
  });

  it("rejects external, protocol-relative, login loops, and a second encoding", () => {
    expect(safeReturnTo(undefined, origin)).toBe("/");
    expect(safeReturnTo("", origin)).toBe("/");
    expect(safeReturnTo("https://evil.example/", origin)).toBe("/");
    expect(safeReturnTo("//evil.example", origin)).toBe("/");
    expect(safeReturnTo("/\\evil.example", origin)).toBe("/");
    expect(safeReturnTo("/\t/evil", origin)).toBe("/");
    expect(safeReturnTo("/login", origin)).toBe("/");
    expect(safeReturnTo("/login?x=1", origin)).toBe("/");
    expect(safeReturnTo("/login/continue", origin)).toBe("/");
    expect(safeReturnTo("%2F%2Fevil.example", origin)).toBe("/");
    expect(safeReturnTo("%252F%252Fevil.example", origin)).toBe("/");
    expect(safeReturnTo("/%2Fevil.example", origin)).toBe("/");
    expect(safeReturnTo("%2Fportfolio", origin)).toBe("/portfolio");
    expect(safeReturnTo(" /portfolio", origin)).toBe("/");
  });
});

describe("display name", () => {
  it("uses a trimmed name and otherwise 已登录", () => {
    expect(publicDisplayName("  林  ")).toBe("林");
    expect(publicDisplayName("ada@example.com")).toBeNull();
    expect(publicDisplayName("+86 138 0013 8000")).toBeNull();
    expect(publicDisplayName("13800138000")).toBeNull();
    expect(accountLabel(null)).toBe("已登录");
    expect(accountLabel("ada@example.com")).toBe("已登录");
    expect(accountLabel("林")).toBe("林");
  });
});

describe("parseAuthSessionResponse", () => {
  it("drops email, phone, and tokens", () => {
    const parsed = parseAuthSessionResponse({
      status: "authenticated",
      authenticated: true,
      expired: false,
      csrfToken: "csrf-token",
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        displayName: "林",
        email: "ada@example.com",
        phone: "13800138000",
        sessionToken: "secret",
      },
      login: { ready: true, method: "oidc", reason: null },
      accessToken: "nope",
    });
    expect(parsed).toEqual({
      status: "authenticated",
      authenticated: true,
      expired: false,
      csrfToken: "csrf-token",
      user: { id: "11111111-1111-4111-8111-111111111111", displayName: "林" },
      login: { ready: true, method: "oidc", reason: null },
    });
    expect(JSON.stringify(parsed)).not.toContain("ada@example.com");
    expect(JSON.stringify(parsed)).not.toContain("secret");
  });

  it("turns an email-shaped display name into an empty label", () => {
    const parsed = parseAuthSessionResponse({
      status: "authenticated",
      authenticated: true,
      expired: false,
      csrfToken: "csrf-token",
      user: { id: "user-1", displayName: "ada@example.com" },
      login: { ready: true, method: "oidc", reason: null },
    });
    expect(parsed?.user?.displayName).toBeNull();
    expect(accountLabel(parsed?.user?.displayName)).toBe("已登录");
  });
});
