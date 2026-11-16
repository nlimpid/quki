import {
  AUTH_PROBE_TIMEOUT_MS,
  type AuthSessionResponse,
  type AuthUnavailableReason,
} from "@quki/types";
import { describe, expect, it } from "vitest";

import {
  GOOGLE_CONSENT_COPY,
  GOOGLE_LOGIN_BUTTON,
  GOOGLE_REJECTED_COPY,
  GOOGLE_UNREACHABLE_COPY,
  LOGIN_CHECK_FAILED_COPY,
  LOGIN_FAILED_COPY,
  LOGIN_UNAVAILABLE_COPY,
  applyProbeFailure,
  applyProbeSuccess,
  applyProbeTimeout,
  beginLogout,
  failLogout,
  finishLogout,
  headerControl,
  loginView,
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
    login: { ready, method: ready ? "oidc" : null, reason: ready ? null : reason },
    ...extra,
  };
}

function guest(reason: AuthUnavailableReason): AuthPhase {
  return { kind: "guest", expired: false, login: { state: "unavailable", reason }, csrfToken: null };
}

describe("auth view state", () => {
  it("keeps a probe failure unknown and does not call that logged out", () => {
    expect(AUTH_PROBE_TIMEOUT_MS).toBe(4_000);
    expect(GOOGLE_LOGIN_BUTTON).toBe("使用 Google 登录");
    const unknown = applyProbeTimeout(initializing);
    expect(unknown).toEqual({ kind: "unknown", login: unknownLogin });
    expect(headerControl(unknown)).toBe("login");
    expect(showLoginCta(unknown)).toBe(true);
    expect(applyProbeFailure(initializing)).toEqual(unknown);
    expect(loginView(unknown).alert).toBe(LOGIN_CHECK_FAILED_COPY);
    expect(loginView(unknown).message).toBeNull();
    expect(portfolioSubtitle(unknown)).not.toContain("未登录");
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
      expect(loginView(phase).message).toBe(LOGIN_UNAVAILABLE_COPY);
      expect(loginView(phase).google).toBe(false);
      expect(loginView(phase).retry).toBe(true);
      const expired = applyProbeSuccess(
        initializing,
        session(false, reason, { expired: true, status: "anonymous" }),
      );
      expect(showExpiryBanner(expired, false)).toBe(true);
      expect(showRelogin(expired, false)).toBe(false);
    }
  });

  it("offers the Google POST only when the server is ready and issued a csrf token", () => {
    const phase = applyProbeSuccess(initializing, session(true, null, { status: "anonymous" }));
    expect(phase).toMatchObject({ kind: "guest", login: { state: "ready" }, csrfToken: "csrf" });
    expect(headerControl(phase)).toBe("login");
    expect(showLoginCta(phase)).toBe(true);
    expect(loginView(phase)).toMatchObject({
      mode: "google",
      message: GOOGLE_CONSENT_COPY,
      google: true,
      retry: false,
    });
    expect(GOOGLE_CONSENT_COPY).toContain("openid 和 profile");
    expect(GOOGLE_CONSENT_COPY).toContain("不请求 email");
    expect(loginView(phase, "provider_rejected").alert).toBe(GOOGLE_REJECTED_COPY);
    expect(loginView(phase, "provider_unreachable").alert).toBe(GOOGLE_UNREACHABLE_COPY);
    expect(loginView(phase, "login_failed").alert).toBe(LOGIN_FAILED_COPY);
    const expired = { ...phase, expired: true } as AuthPhase;
    expect(showExpiryBanner(expired, false)).toBe(true);
    expect(showRelogin(expired, false)).toBe(true);
    expect(showRelogin(expired, true)).toBe(false);
    const noCsrf = { ...phase, csrfToken: null } as AuthPhase;
    expect(showLoginCta(noCsrf)).toBe(false);
    expect(loginView(noCsrf).google).toBe(false);
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

  it("lets Tab leave the account panel instead of wrapping focus", () => {
    expect(panelTabLeaves(false, 0, 1)).toBe(true);
    expect(panelTabLeaves(true, 0, 1)).toBe(true);
    expect(panelTabLeaves(false, 0, 2)).toBe(false);
    expect(panelTabLeaves(false, 1, 2)).toBe(true);
    expect(panelTabLeaves(true, 1, 2)).toBe(false);
    expect(panelTabLeaves(true, 0, 2)).toBe(true);
  });
});
