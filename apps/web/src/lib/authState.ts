import type { AuthSessionResponse } from "@quki/types";

/** View state for the header and /login. Unknown is not treated as logged out. */
export type AuthPhase =
  | { kind: "initializing" }
  | { kind: "unknown" }
  | { kind: "guest"; expired: boolean }
  | { kind: "authenticated"; displayName: string | null; csrfToken: string }
  | { kind: "logoutPending"; displayName: string | null; csrfToken: string }
  | { kind: "logoutFailed"; displayName: string | null; csrfToken: string };

export function sessionToPhase(session: AuthSessionResponse): AuthPhase {
  if (session.status === "authenticated" && session.user && session.csrfToken) {
    return {
      kind: "authenticated",
      displayName: session.user.displayName,
      csrfToken: session.csrfToken,
    };
  }
  return { kind: "guest", expired: session.expired };
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
  return { kind: "unknown" };
}

export function applyProbeTimeout(phase: AuthPhase): AuthPhase {
  return phase.kind === "initializing" ? { kind: "unknown" } : phase;
}

export function beginLogout(phase: AuthPhase): AuthPhase {
  if (phase.kind !== "authenticated" && phase.kind !== "logoutFailed") return phase;
  return { kind: "logoutPending", displayName: phase.displayName, csrfToken: phase.csrfToken };
}

export function finishLogout(): AuthPhase {
  return { kind: "guest", expired: false };
}

export function failLogout(phase: AuthPhase): AuthPhase {
  if (phase.kind !== "logoutPending") return phase;
  return { kind: "logoutFailed", displayName: phase.displayName, csrfToken: phase.csrfToken };
}

export function headerControl(phase: AuthPhase): "spinner" | "login" | "account" {
  if (phase.kind === "initializing") return "spinner";
  if (
    phase.kind === "authenticated" ||
    phase.kind === "logoutPending" ||
    phase.kind === "logoutFailed"
  ) {
    return "account";
  }
  return "login";
}

export function showExpiryBanner(phase: AuthPhase, dismissed: boolean): boolean {
  return phase.kind === "guest" && phase.expired && !dismissed;
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

/** The provider is not selected, so the login card cannot submit anything. */
export function loginSlotModel(): { interactive: false; fields: [] } {
  return { interactive: false, fields: [] };
}
