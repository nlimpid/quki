import type { AuthSessionResponse, AuthUnavailableReason } from "@quki/types";

/**
 * Server `login.ready` and the on-screen sign-in control are separate.
 * The API may be ready before a provider and a real consent sentence exist.
 * Until both are chosen, the page must not offer a login button.
 */
export const LOGIN_UI_ENABLED = false;

export const LOGIN_UNAVAILABLE_COPY = "登录暂不可用。访客仍可查看行情，并在本机管理持仓。";
export const LOGIN_CHECK_FAILED_COPY = "无法确认登录状态，请重试。";
export const LOGIN_PRIVACY_COPY =
  "登录不会上传或云同步你的本地持仓。持仓仍仅保存在此浏览器，清除站点数据会丢失。";

/** What the last successful session response said about starting a new login. */
export type LoginCapability =
  | { state: "unknown" }
  | { state: "unavailable"; reason: AuthUnavailableReason }
  | { state: "ready" };

const unknownLogin: LoginCapability = { state: "unknown" };

/** Session identity and login capability stay independent. */
export type AuthPhase =
  | { kind: "initializing"; login: LoginCapability }
  | { kind: "unknown"; login: LoginCapability }
  | { kind: "guest"; expired: boolean; login: LoginCapability }
  | {
      kind: "authenticated";
      displayName: string | null;
      csrfToken: string;
      login: LoginCapability;
    }
  | {
      kind: "logoutPending";
      displayName: string | null;
      csrfToken: string;
      login: LoginCapability;
    }
  | {
      kind: "logoutFailed";
      displayName: string | null;
      csrfToken: string;
      login: LoginCapability;
    };

export function loginCapability(session: AuthSessionResponse): LoginCapability {
  if (!session.login.ready) {
    return { state: "unavailable", reason: session.login.reason ?? "auth_not_configured" };
  }
  return { state: "ready" };
}

export function sessionToPhase(session: AuthSessionResponse): AuthPhase {
  const login = loginCapability(session);
  if (session.status === "authenticated" && session.user && session.csrfToken) {
    return {
      kind: "authenticated",
      displayName: session.user.displayName,
      csrfToken: session.csrfToken,
      login,
    };
  }
  return { kind: "guest", expired: session.expired, login };
}

export function applyProbeSuccess(phase: AuthPhase, session: AuthSessionResponse): AuthPhase {
  if (phase.kind === "logoutPending") return phase;
  if (phase.kind === "logoutFailed" && session.status === "authenticated") return phase;
  return sessionToPhase(session);
}

export function applyProbeFailure(phase: AuthPhase): AuthPhase {
  if (
    phase.kind === "authenticated" ||
    phase.kind === "logoutPending" ||
    phase.kind === "logoutFailed" ||
    phase.kind === "guest"
  ) {
    return phase;
  }
  return { kind: "unknown", login: unknownLogin };
}

export function applyProbeTimeout(phase: AuthPhase): AuthPhase {
  return phase.kind === "initializing" ? { kind: "unknown", login: unknownLogin } : phase;
}

export function beginLogout(phase: AuthPhase): AuthPhase {
  if (phase.kind !== "authenticated" && phase.kind !== "logoutFailed") return phase;
  return {
    kind: "logoutPending",
    displayName: phase.displayName,
    csrfToken: phase.csrfToken,
    login: phase.login,
  };
}

export function finishLogout(phase: AuthPhase): AuthPhase {
  return { kind: "guest", expired: false, login: phase.login };
}

export function failLogout(phase: AuthPhase): AuthPhase {
  if (phase.kind !== "logoutPending") return phase;
  return {
    kind: "logoutFailed",
    displayName: phase.displayName,
    csrfToken: phase.csrfToken,
    login: phase.login,
  };
}

/** Header "登录" is a real sign-in link only after the product gate is on. Unknown still links to /login as a session check. */
export function showLoginCta(phase: AuthPhase, uiEnabled = LOGIN_UI_ENABLED): boolean {
  if (phase.kind === "unknown") return true;
  if (phase.kind !== "guest") return false;
  return uiEnabled && phase.login.state === "ready";
}

export function headerControl(
  phase: AuthPhase,
  uiEnabled = LOGIN_UI_ENABLED,
): "spinner" | "login" | "account" | "none" {
  if (phase.kind === "initializing") return "spinner";
  if (
    phase.kind === "authenticated" ||
    phase.kind === "logoutPending" ||
    phase.kind === "logoutFailed"
  ) {
    return "account";
  }
  return showLoginCta(phase, uiEnabled) ? "login" : "none";
}

export function showExpiryBanner(phase: AuthPhase, dismissed: boolean): boolean {
  return phase.kind === "guest" && phase.expired && !dismissed;
}

export function showRelogin(
  phase: AuthPhase,
  dismissed: boolean,
  uiEnabled = LOGIN_UI_ENABLED,
): boolean {
  return showExpiryBanner(phase, dismissed) && uiEnabled && phase.login.state === "ready";
}

export function portfolioSubtitle(phase: AuthPhase): string {
  if (
    phase.kind === "authenticated" ||
    phase.kind === "logoutPending" ||
    phase.kind === "logoutFailed"
  ) {
    return "账户股数单独保存。本机持仓不会自动上传、覆盖、合并或清除；只有你确认导入后才会写入账户。";
  }
  if (phase.kind === "guest") {
    return "本地保存 · 未登录。数据仅保存在此浏览器，清除站点数据会丢失。登录不会上传本地持仓。";
  }
  return "本地保存。数据仅保存在此浏览器，清除站点数据会丢失。登录不会自动上传本地持仓。";
}

export function usesAccountHoldings(phase: AuthPhase): boolean {
  return (
    phase.kind === "authenticated" ||
    phase.kind === "logoutPending" ||
    phase.kind === "logoutFailed"
  );
}

export type LoginView = {
  mode: "checking" | "returning" | "check_failed" | "unavailable";
  status: string | null;
  alert: string | null;
  message: string | null;
  retry: boolean;
};

/** Settled anonymous sessions stay on the unavailable card until a provider and consent exist. */
export function loginView(phase: AuthPhase, loginFailed = false): LoginView {
  if (phase.kind === "initializing") {
    return {
      mode: "checking",
      status: "正在确认登录状态…",
      alert: null,
      message: null,
      retry: false,
    };
  }
  if (
    phase.kind === "authenticated" ||
    phase.kind === "logoutPending" ||
    phase.kind === "logoutFailed"
  ) {
    return {
      mode: "returning",
      status: "已登录，正在返回…",
      alert: null,
      message: null,
      retry: false,
    };
  }
  if (phase.kind === "unknown") {
    return {
      mode: "check_failed",
      status: null,
      alert: LOGIN_CHECK_FAILED_COPY,
      message: null,
      retry: true,
    };
  }
  return {
    mode: "unavailable",
    status: null,
    alert: loginFailed ? "登录失败，请重试。" : null,
    message: LOGIN_UNAVAILABLE_COPY,
    retry: true,
  };
}

/** Tab leaves a non-modal panel. It does not wrap focus. */
export function panelTabLeaves(shiftKey: boolean, index: number, count: number): boolean {
  if (count <= 0) return true;
  if (shiftKey) return index <= 0;
  return index >= count - 1;
}
