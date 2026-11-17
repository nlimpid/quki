import { AUTH_PROBE_TIMEOUT_MS } from "@quki/types";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
  /** Clerk session JWT for this probe, or null. Holdings must send this bearer. */
  accessToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  sessionKey = "static",
  getAccessToken,
  onLogout,
}: {
  children: ReactNode;
  /** `loading` waits. Any other change, including a new Clerk user id, starts a new probe. */
  sessionKey?: string;
  getAccessToken?: () => Promise<string | null>;
  onLogout?: () => Promise<void>;
}) {
  const [phase, setPhase] = useState<AuthPhase>({
    kind: "initializing",
    login: { state: "unknown" },
  });
  const [generation, setGeneration] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [expiryDismissed, setExpiryDismissed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const tokenRef = useRef(getAccessToken);
  useEffect(() => {
    tokenRef.current = getAccessToken;
  }, [getAccessToken]);

  useEffect(() => {
    if (sessionKey === "loading") return;
    const startedAt = generation;
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = window.setTimeout(() => {
      if (controller.signal.aborted || startedAt !== generation) return;
      setPhase((current) => applyProbeTimeout(current));
    }, AUTH_PROBE_TIMEOUT_MS);
    void (async () => {
      const readToken = tokenRef.current;
      const token = readToken ? await readToken() : null;
      if (controller.signal.aborted) return;
      return fetchSession(fetch, token, controller.signal);
    })()
      .then((session) => {
        if (!session || controller.signal.aborted) return;
        setPhase((current) => applyProbeSuccess(current, session));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPhase((current) => applyProbeFailure(current));
      })
      .finally(() => {
        if (!controller.signal.aborted) setRetrying(false);
      });
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [generation, sessionKey]);

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

  const accessToken = useCallback(
    () => (tokenRef.current ? tokenRef.current() : Promise.resolve(null)),
    [],
  );

  const logout = async () => {
    const pending = beginLogout(phase);
    if (pending.kind !== "logoutPending") return;
    abortRef.current?.abort();
    setPhase(pending);
    try {
      if (onLogout) await onLogout();
      else await logoutSession(tokenRef.current ? await tokenRef.current() : null);
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
        accessToken,
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
