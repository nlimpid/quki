import { safeReturnTo } from "@quki/types";
import { useState } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "./auth.js";
import { LOGIN_CHECK_FAILED_COPY, holdingMutation, type AuthPhase } from "./authState.js";

export function loginReturnHref(intentPath: string, origin: string): string {
  const returnTo = safeReturnTo(intentPath, origin);
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}

export function accountActionReady(
  phaseKind: string,
  sessionKey: string,
  confirmedSessionKey: string | null,
): boolean {
  return phaseKind === "authenticated" && confirmedSessionKey === sessionKey;
}

export function useHoldingIntent() {
  const { phase, retry, sessionKey, confirmedSessionKey } = useAuth();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);

  function request(intentPath: string): boolean {
    const decision = holdingMutation(phase);
    if (decision === "allow" && !accountActionReady(phase.kind, sessionKey, confirmedSessionKey)) {
      setNotice("正在确认登录状态…");
      return false;
    }
    if (decision === "allow") {
      setNotice(null);
      return true;
    }
    if (decision === "login") {
      navigate(loginReturnHref(intentPath, window.location.origin));
      return false;
    }
    setNotice(decision === "wait" ? "正在确认登录状态…" : LOGIN_CHECK_FAILED_COPY);
    return false;
  }

  return { phase, notice, request, retry };
}

export function isAuthenticated(phase: AuthPhase): boolean {
  return phase.kind === "authenticated";
}
