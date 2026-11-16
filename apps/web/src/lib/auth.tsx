import { AUTH_PROBE_TIMEOUT_MS } from "@quki/types";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { fetchSession, logoutSession } from "./authClient.js";
import {
  applyProbeFailure,
  applyProbeSuccess,
  applyProbeTimeout,
  beginLogout,
  failLogout,
  finishLogout,
  type AuthPhase,
} from "./authState.js";

type AuthContextValue = {
  phase: AuthPhase;
  retrying: boolean;
  expiryDismissed: boolean;
  retry: () => void;
  /** Ask the server again. Used when opening /login. Does not mark a known guest as logged out. */
  recheck: () => void;
  logout: () => Promise<void>;
  dismissExpiry: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<AuthPhase>({
    kind: "initializing",
    login: { state: "unknown" },
  });
  const [generation, setGeneration] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [expiryDismissed, setExpiryDismissed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const startedAt = generation;
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = window.setTimeout(() => {
      if (controller.signal.aborted || startedAt !== generation) return;
      setPhase((current) => applyProbeTimeout(current));
    }, AUTH_PROBE_TIMEOUT_MS);
    void fetchSession()
      .then((session) => {
        if (controller.signal.aborted) return;
        setPhase((current) => applyProbeSuccess(current, session));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setPhase((current) => applyProbeFailure(current));
      })
      .finally(() => {
        if (!controller.signal.aborted) setRetrying(false);
      });
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [generation]);

  const retry = () => {
    setRetrying(true);
    setPhase({ kind: "initializing", login: { state: "unknown" } });
    setGeneration((current) => current + 1);
  };

  const recheck = () => {
    setPhase((current) =>
      current.kind === "unknown" ? { kind: "initializing", login: { state: "unknown" } } : current,
    );
    setGeneration((current) => current + 1);
  };

  const logout = async () => {
    const pending = beginLogout(phase);
    if (pending.kind !== "logoutPending") return;
    abortRef.current?.abort();
    setPhase(pending);
    try {
      await logoutSession(pending.csrfToken);
      setPhase(finishLogout(pending));
      setExpiryDismissed(false);
    } catch {
      setPhase(failLogout(pending));
    }
  };

  return (
    <AuthContext.Provider
      value={{
        phase,
        retrying,
        expiryDismissed,
        retry,
        recheck,
        logout,
        dismissExpiry: () => setExpiryDismissed(true),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("登录状态尚未就绪");
  return value;
}
