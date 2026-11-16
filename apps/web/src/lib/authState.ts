import type { AuthSessionResponse, AuthUnavailableReason } from "@quki/types";

export const LOGIN_UNAVAILABLE_COPY = "登录暂不可用。访客仍可查看行情，并在本机管理持仓。";
export const LOGIN_CHECK_FAILED_COPY = "无法确认登录状态，请重试。";
export const LOGIN_PRIVACY_COPY =
  "登录不会上传或云同步你的本地持仓。持仓仍仅保存在此浏览器，清除站点数据会丢失。";
export const GOOGLE_LOGIN_BUTTON = "使用 Google 登录";
/** Matches the scopes the server is allowed to request. Name is not guaranteed. */
export const GOOGLE_CONSENT_COPY =
  "使用 Google 登录会打开 Google 的页面。本站只请求 openid 和 profile。Google 会返回账号的 sub，并可能返回姓名；姓名不是每次都有，也不能当作账号标识。本站保存 ID 令牌里的 iss 与 sub，以及可显示的姓名。不请求 email，不保存访问令牌或刷新令牌。行情页面仍公开。本机持仓不会因登录而上传、合并或清除。";
export const GOOGLE_REJECTED_COPY = "Google 没有同意这次登录。本站没有建立会话，本机持仓未改。";
export const GOOGLE_UNREACHABLE_COPY = "暂时联系不上 Google。登录没有完成，本机持仓未改。";
export const LOGIN_FAILED_COPY = "登录没有完成。本站没有建立会话，本机持仓未改。";

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
  | { kind: "guest"; expired: boolean; login: LoginCapability; csrfToken: string | null }
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
  return { kind: "guest", expired: session.expired, login, csrfToken: session.csrfToken };
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
  return { kind: "guest", expired: false, login: phase.login, csrfToken: null };
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

/** Header 登录 opens /login. The Google POST is shown only when the server says it is ready. */
export function showLoginCta(phase: AuthPhase): boolean {
  if (phase.kind === "unknown") return true;
  if (phase.kind !== "guest") return false;
  return phase.login.state === "ready" && phase.csrfToken != null && phase.csrfToken.length > 0;
}

export function headerControl(phase: AuthPhase): "spinner" | "login" | "account" | "none" {
  if (phase.kind === "initializing") return "spinner";
  if (
    phase.kind === "authenticated" ||
    phase.kind === "logoutPending" ||
    phase.kind === "logoutFailed"
  ) {
    return "account";
  }
  return showLoginCta(phase) ? "login" : "none";
}

export function showExpiryBanner(phase: AuthPhase, dismissed: boolean): boolean {
  return phase.kind === "guest" && phase.expired && !dismissed;
}

export function showRelogin(phase: AuthPhase, dismissed: boolean): boolean {
  return showExpiryBanner(phase, dismissed) && showLoginCta(phase);
}

export function portfolioSubtitle(phase: AuthPhase): string {
  if (
    phase.kind === "authenticated" ||
    phase.kind === "logoutPending" ||
    phase.kind === "logoutFailed"
  ) {
    return "本地保存。持仓仍仅保存在此浏览器，不会因登录而同步到云端。";
  }
  if (phase.kind === "guest") {
    return "本地保存 · 未登录。数据仅保存在此浏览器，清除站点数据会丢失。登录不会上传本地持仓。";
  }
  return "本地保存。数据仅保存在此浏览器，清除站点数据会丢失。登录不会上传本地持仓。";
}

export type LoginFailure = "none" | "login_failed" | "provider_rejected" | "provider_unreachable";

export type LoginView = {
  mode: "checking" | "returning" | "check_failed" | "unavailable" | "google";
  status: string | null;
  alert: string | null;
  message: string | null;
  retry: boolean;
  google: boolean;
};

function failureAlert(failure: LoginFailure): string | null {
  if (failure === "provider_rejected") return GOOGLE_REJECTED_COPY;
  if (failure === "provider_unreachable") return GOOGLE_UNREACHABLE_COPY;
  if (failure === "login_failed") return LOGIN_FAILED_COPY;
  return null;
}

/** The Google button follows server readiness. It is not a local on/off flag. */
export function loginView(phase: AuthPhase, failure: LoginFailure = "none"): LoginView {
  if (phase.kind === "initializing") {
    return {
      mode: "checking",
      status: "正在确认登录状态…",
      alert: null,
      message: null,
      retry: false,
      google: false,
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
      google: false,
    };
  }
  if (phase.kind === "unknown") {
    return {
      mode: "check_failed",
      status: null,
      alert: LOGIN_CHECK_FAILED_COPY,
      message: null,
      retry: true,
      google: false,
    };
  }
  const google = showLoginCta(phase);
  return {
    mode: google ? "google" : "unavailable",
    status: null,
    alert: failureAlert(failure),
    message: google ? GOOGLE_CONSENT_COPY : LOGIN_UNAVAILABLE_COPY,
    retry: !google,
    google,
  };
}

/** Tab leaves a non-modal panel. It does not wrap focus. */
export function panelTabLeaves(shiftKey: boolean, index: number, count: number): boolean {
  if (count <= 0) return true;
  if (shiftKey) return index <= 0;
  return index >= count - 1;
}
