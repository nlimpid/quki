import { safeReturnTo, type AuthSessionResponse, type AuthUnavailableReason } from "@quki/types";

export const LOGIN_UNAVAILABLE_COPY =
  "登录暂不可用。访客仍可查看行情。此浏览器里的旧持仓只供查看。";
export const LOGIN_CHECK_FAILED_COPY = "无法确认登录状态，请重试。";
export const LOGIN_PRIVACY_COPY =
  "此浏览器里的旧持仓不会上传、合并或删除。登录后的账户持仓保存在服务器。清除站点数据会丢失旧列表，不会删除账户持仓。";
export const ACCOUNT_SAVE_COPY = "保存到账户。不会上传、合并或删除此浏览器里的旧持仓。";
export const ACCOUNT_SAVE_LABEL = "保存到账户";

/** Absolute same-origin URL after an explicit logout. External and /login targets become the site root. */
export function logoutReturnUrl(pathAndSearch: string, origin: string): string {
  return new URL(safeReturnTo(pathAndSearch, origin), origin).toString();
}

/** Same-origin continuation for Clerk sign-in and the combined email sign-up flow. */
export function clerkFlowRedirects(returnTo: string): {
  forceRedirectUrl: string;
  fallbackRedirectUrl: string;
  signUpUrl: string;
  signUpForceRedirectUrl: string;
  signUpFallbackRedirectUrl: string;
} {
  return {
    forceRedirectUrl: returnTo,
    fallbackRedirectUrl: returnTo,
    signUpForceRedirectUrl: returnTo,
    signUpFallbackRedirectUrl: returnTo,
    signUpUrl: `/login?returnTo=${encodeURIComponent(returnTo)}`,
  };
}

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

/** A rejected bearer is not a transport failure. Drop the account view and probe again. */
export function rejectCredential(phase: AuthPhase): AuthPhase {
  if (phase.kind === "logoutPending") return phase;
  return { kind: "initializing", login: unknownLogin };
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

/** Header "登录" appears for an unknown probe and for a guest whose Worker session is ready. */
export function showLoginCta(phase: AuthPhase): boolean {
  if (phase.kind === "unknown") return true;
  if (phase.kind !== "guest") return false;
  return phase.login.state === "ready";
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
  return showExpiryBanner(phase, dismissed) && phase.login.state === "ready";
}

export type HoldingMutation = "allow" | "wait" | "retry" | "login";

/** Local add, edit, and delete are closed unless the session is a confirmed account. */
export function holdingMutation(phase: AuthPhase): HoldingMutation {
  if (phase.kind === "authenticated") return "allow";
  if (phase.kind === "initializing" || phase.kind === "logoutPending") return "wait";
  if (phase.kind === "unknown" || phase.kind === "logoutFailed") return "retry";
  return "login";
}

export function portfolioSubtitle(phase: AuthPhase): string {
  if (phase.kind === "authenticated") {
    return "账户持仓保存在服务器。此浏览器里的旧列表只供查看，不会自动上传。";
  }
  if (phase.kind === "logoutPending" || phase.kind === "logoutFailed") {
    return "正在确认账户。旧列表只供查看，不会因登录而同步到云端。";
  }
  if (phase.kind === "initializing") return "正在确认登录状态。旧列表只供查看。";
  if (phase.kind === "unknown") return "无法确认登录状态。旧列表只供查看。";
  return "未登录。此浏览器里的旧持仓只供查看，新增、修改和删除需要登录。";
}

export type LoginView = {
  mode: "checking" | "returning" | "check_failed" | "unavailable" | "ready";
  status: string | null;
  alert: string | null;
  message: string | null;
  retry: boolean;
};

/** Ready guests get the Clerk form. Unconfigured guests get only the unavailable card. */
export function loginView(
  phase: AuthPhase,
  loginFailed: boolean | string | null = false,
): LoginView {
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
  if (phase.login.state === "ready") {
    return {
      mode: "ready",
      status: null,
      alert: loginFailed ? "登录失败，请重试。" : null,
      message: null,
      retry: false,
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
