import { AUTH_PROBE_TIMEOUT_MS } from "@quki/types";
import { describe, expect, it } from "vitest";

import {
  applyProbeFailure,
  applyProbeSuccess,
  applyProbeTimeout,
  beginLogout,
  failLogout,
  finishLogout,
  headerControl,
  loginSlotModel,
  portfolioSubtitle,
  showExpiryBanner,
  type AuthPhase,
} from "./authState.js";

const authenticated: AuthPhase = { kind: "authenticated", displayName: null, csrfToken: "csrf" };
const anonymous = {
  status: "anonymous" as const,
  authenticated: false as const,
  expired: false,
  user: null,
  csrfToken: "csrf",
  login: { ready: true as const, method: "oidc" as const, reason: null },
};

describe("auth view state", () => {
  it("keeps a network failure unknown and still accepts a late session", () => {
    expect(AUTH_PROBE_TIMEOUT_MS).toBe(4_000);
    expect(applyProbeTimeout({ kind: "initializing" })).toEqual({ kind: "unknown" });
    expect(headerControl({ kind: "unknown" })).toBe("login");
    expect(applyProbeFailure({ kind: "initializing" })).toEqual({ kind: "unknown" });
    expect(applyProbeFailure(authenticated)).toEqual(authenticated);
    expect(portfolioSubtitle({ kind: "unknown" })).not.toContain("未登录");
    const late = applyProbeSuccess(
      { kind: "unknown" },
      {
        ...anonymous,
        status: "authenticated",
        authenticated: true,
        user: { id: "user-1", displayName: "林" },
      },
    );
    expect(late).toMatchObject({ kind: "authenticated", displayName: "林" });
  });

  it("shows a passive expiry banner and does not describe logout failure as success", () => {
    const expired = applyProbeSuccess(authenticated, { ...anonymous, expired: true });
    expect(expired).toEqual({ kind: "guest", expired: true });
    expect(showExpiryBanner(expired, false)).toBe(true);
    expect(showExpiryBanner(expired, true)).toBe(false);
    expect(headerControl(expired)).toBe("login");
    expect(JSON.stringify(expired)).not.toMatch(/holding/i);

    const pending = beginLogout(authenticated);
    expect(pending.kind).toBe("logoutPending");
    const failed = failLogout(pending);
    expect(failed.kind).toBe("logoutFailed");
    expect(headerControl(failed)).toBe("account");
    expect(finishLogout()).toEqual({ kind: "guest", expired: false });
    expect(portfolioSubtitle(failed)).toContain("不会因登录而同步到云端");
    expect(portfolioSubtitle({ kind: "guest", expired: false })).toContain("未登录");
    expect(portfolioSubtitle({ kind: "guest", expired: false })).not.toContain("同步即将");
  });

  it("leaves the login slot non-interactive", () => {
    expect(loginSlotModel()).toEqual({ interactive: false, fields: [] });
  });
});
