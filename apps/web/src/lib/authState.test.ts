import {
  AUTH_PROBE_TIMEOUT_MS,
  type AuthSessionResponse,
  type AuthUnavailableReason,
} from "@quki/types";
import { describe, expect, it } from "vitest";

import {
  LOGIN_CHECK_FAILED_COPY,
  LOGIN_PRIVACY_COPY,
  LOGIN_UNAVAILABLE_COPY,
  clerkFlowRedirects,
  applyProbeFailure,
  applyProbeSuccess,
  applyProbeTimeout,
  beginLogout,
  failLogout,
  finishLogout,
  headerControl,
  rejectCredential,
  holdingMutation,
  loginReturnTarget,
  loginView,
  logoutReturnUrl,
  panelTabLeaves,
  portfolioSubtitle,
  showExpiryBanner,
  showLoginCta,
  showRelogin,
  type AuthPhase,
} from "./authState.js";

const unknownLogin = { state: "unknown" as const };
const initializing: AuthPhase = { kind: "initializing", login: unknownLogin };

function session(
  ready: boolean,
  reason: AuthUnavailableReason | null,
  extra: Partial<AuthSessionResponse> = {},
): AuthSessionResponse {
  return {
    status: ready ? "anonymous" : "unavailable",
    authenticated: false,
    expired: false,
    user: null,
    csrfToken: ready ? "csrf" : null,
    login: { ready, method: ready ? "clerk" : null, reason: ready ? null : reason },
    ...extra,
  };
}

function guest(reason: AuthUnavailableReason): AuthPhase {
  return { kind: "guest", expired: false, login: { state: "unavailable", reason } };
}

describe("auth view state", () => {
  it("keeps a probe failure unknown and does not call that logged out", () => {
    expect(AUTH_PROBE_TIMEOUT_MS).toBe(4_000);
    const unknown = applyProbeTimeout(initializing);
    expect(unknown).toEqual({ kind: "unknown", login: unknownLogin });
    expect(headerControl(unknown)).toBe("login");
    expect(showLoginCta(unknown)).toBe(true);
    expect(applyProbeFailure(initializing)).toEqual(unknown);
    const signedIn = {
      kind: "authenticated" as const,
      displayName: "林",
      csrfToken: "csrf",
      login: { state: "ready" as const },
    };
    expect(rejectCredential(signedIn)).toEqual({ kind: "initializing", login: unknownLogin });
    expect(rejectCredential({ ...signedIn, kind: "logoutPending" })).toMatchObject({
      kind: "logoutPending",
    });
    expect(loginView(unknown).alert).toBe(LOGIN_CHECK_FAILED_COPY);
    expect(loginView(unknown).message).toBeNull();
    expect(portfolioSubtitle(unknown)).not.toContain("未登录");
    expect(LOGIN_PRIVACY_COPY).toContain("旧持仓不会上传");
    expect(LOGIN_PRIVACY_COPY).toContain("账户持仓保存在服务器");
    expect(LOGIN_PRIVACY_COPY).not.toContain("持仓仍仅保存在此浏览器");
    const redirects = clerkFlowRedirects("/portfolio?add=1");
    expect(redirects.forceRedirectUrl).toBe("/portfolio?add=1");
    expect(redirects.signUpForceRedirectUrl).toBe("/portfolio?add=1");
    expect(redirects.signUpUrl).toBe("/login?returnTo=%2Fportfolio%3Fadd%3D1");
    expect(redirects.signUpUrl.startsWith("/login?")).toBe(true);
    expect(portfolioSubtitle(unknown)).not.toContain("登录暂不可用");
  });

  it("hides login and relogin when the server is not ready", () => {
    const reasons: AuthUnavailableReason[] = [
      "auth_not_configured",
      "storage_unconfigured",
      "scopes_not_confirmed",
    ];
    for (const reason of reasons) {
      const phase = applyProbeSuccess(initializing, session(false, reason));
      expect(phase).toMatchObject({ kind: "guest", login: { state: "unavailable", reason } });
      expect(headerControl(phase)).toBe("none");
      expect(showLoginCta(phase)).toBe(false);
      expect(loginView(phase).mode).toBe("unavailable");
      expect(loginView(phase).message).toBe(LOGIN_UNAVAILABLE_COPY);
      expect(loginView(phase).retry).toBe(true);
      expect(loginView(phase, "login_failed").alert).toBe("登录失败，请重试。");
      expect(loginView(phase, "login_failed").message).toBe(LOGIN_UNAVAILABLE_COPY);
      const expired = applyProbeSuccess(
        initializing,
        session(false, reason, { expired: true, status: "anonymous" }),
      );
      expect(showExpiryBanner(expired, false)).toBe(true);
      expect(showRelogin(expired, false)).toBe(false);
    }
  });

  it("offers login when the Worker session is ready", () => {
    const phase = applyProbeSuccess(initializing, session(true, null, { status: "anonymous" }));
    expect(phase).toMatchObject({ kind: "guest", login: { state: "ready" } });
    expect(headerControl(phase)).toBe("login");
    expect(showLoginCta(phase)).toBe(true);
    expect(loginView(phase).mode).toBe("ready");
    expect(loginView(phase).message).toBeNull();
    expect(loginView(phase).retry).toBe(false);
    const expired = { ...phase, expired: true } as AuthPhase;
    expect(showExpiryBanner(expired, false)).toBe(true);
    expect(showRelogin(expired, false)).toBe(true);
    expect(showRelogin(expired, true)).toBe(false);
  });

  it("keeps an existing account usable when new login is unavailable", () => {
    const signedIn = applyProbeSuccess(initializing, {
      status: "authenticated",
      authenticated: true,
      expired: false,
      user: { id: "user-1", displayName: "林" },
      csrfToken: "csrf",
      login: { ready: false, method: null, reason: "auth_not_configured" },
    });
    expect(signedIn).toMatchObject({
      kind: "authenticated",
      displayName: "林",
      login: { state: "unavailable", reason: "auth_not_configured" },
    });
    expect(headerControl(signedIn)).toBe("account");
    expect(applyProbeFailure(signedIn)).toEqual(signedIn);
    const pending = beginLogout(signedIn);
    expect(pending.kind).toBe("logoutPending");
    const failed = failLogout(pending);
    expect(failed.kind).toBe("logoutFailed");
    expect(headerControl(failed)).toBe("account");
    expect(finishLogout(pending)).toMatchObject({
      kind: "guest",
      expired: false,
      login: { state: "unavailable", reason: "auth_not_configured" },
    });
    expect(headerControl(finishLogout(pending))).toBe("none");
    expect(portfolioSubtitle(failed)).toContain("不会因登录而同步到云端");
    expect(portfolioSubtitle(guest("auth_not_configured"))).toContain("未登录");
    expect(holdingMutation(signedIn)).toBe("allow");
    expect(holdingMutation(pending)).toBe("wait");
    expect(holdingMutation(failed)).toBe("retry");
    expect(holdingMutation(guest("auth_not_configured"))).toBe("login");
    expect(holdingMutation(initializing)).toBe("wait");
    expect(holdingMutation({ kind: "unknown", login: unknownLogin })).toBe("retry");
  });

  it("accepts a late session after the probe timed out", () => {
    const late = applyProbeSuccess(applyProbeTimeout(initializing), {
      status: "authenticated",
      authenticated: true,
      expired: false,
      user: { id: "user-1", displayName: null },
      csrfToken: "csrf",
      login: { ready: false, method: null, reason: "storage_unconfigured" },
    });
    expect(late).toMatchObject({ kind: "authenticated", displayName: null });
  });

  it("keeps logout on this site", () => {
    const origin = "https://quki.cc";
    expect(logoutReturnUrl("/portfolio?add=1", origin)).toBe("https://quki.cc/portfolio?add=1");
    expect(logoutReturnUrl("/portfolio?add=1#holdings", origin)).toBe(
      "https://quki.cc/portfolio?add=1#holdings",
    );
    expect(logoutReturnUrl("https://evil.example/steal", origin)).toBe("https://quki.cc/");
    expect(logoutReturnUrl("/login?returnTo=/portfolio", origin)).toBe("https://quki.cc/");
    expect(logoutReturnUrl("/login/create/verify-email-address", origin)).toBe("https://quki.cc/");
  });

  it("keeps a safe return target across Clerk nested sign-in and sign-up paths", () => {
    const origin = "https://quki.cc";
    const storage = new Map<string, string>();
    const store = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    expect(loginReturnTarget("?returnTo=%2Fportfolio", "/login", origin, store)).toBe("/portfolio");
    for (const path of [
      "/login/create",
      "/login/create/verify-email-address",
      "/login/factor-one",
      "/login/verify-email-address",
    ]) {
      expect(loginReturnTarget("", path, origin, store)).toBe("/portfolio");
      expect(clerkFlowRedirects(loginReturnTarget("", path, origin, store)).forceRedirectUrl).toBe(
        "/portfolio",
      );
    }
    expect(
      loginReturnTarget("?returnTo=%2Fportfolio%3Fadd%3D1%23holdings", "/login", origin, store),
    ).toBe("/portfolio?add=1#holdings");
    expect(
      loginReturnTarget("", "/login/create/verify-email-address", origin, store),
    ).toBe("/portfolio?add=1#holdings");
    expect(loginReturnTarget("?returnTo=https://evil.example", "/login", origin, store)).toBe("/");
    expect(storage.size).toBe(0);
    expect(loginReturnTarget("", "/login/create/verify-email-address", origin, store)).toBe("/");
    expect(loginReturnTarget("?returnTo=%2F%2Fevil.example", "/login", origin, store)).toBe("/");
    expect(loginReturnTarget("?returnTo=%2Fportfolio", "/login", origin, store)).toBe("/portfolio");
    storage.set("qk.login.return", "https://evil.example/phish");
    expect(loginReturnTarget("", "/login/factor-one", origin, store)).toBe("/");
  });

  it("lets Tab leave the account panel instead of wrapping focus", () => {
    expect(panelTabLeaves(false, 0, 1)).toBe(true);
    expect(panelTabLeaves(true, 0, 1)).toBe(true);
    expect(panelTabLeaves(false, 0, 2)).toBe(false);
    expect(panelTabLeaves(false, 1, 2)).toBe(true);
    expect(panelTabLeaves(true, 1, 2)).toBe(false);
    expect(panelTabLeaves(true, 0, 2)).toBe(true);
  });
});
