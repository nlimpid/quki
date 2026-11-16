import { DIVIDEND_DISCLAIMER, safeReturnTo } from "@quki/types";
import { useEffect, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { AppHeader } from "../components/AppHeader.js";
import { useAuth } from "../lib/auth.js";
import { LOGIN_PRIVACY_COPY, loginView } from "../lib/authState.js";

export function LoginPage() {
  const { phase, retry, retrying } = useAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnTo = safeReturnTo(params.get("returnTo"), window.location.origin);
  const view = loginView(phase, params.get("error") === "login_failed");
  const busy = retrying || phase.kind === "initializing";

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (phase.kind === "authenticated") navigate(returnTo, { replace: true });
  }, [navigate, phase.kind, returnTo]);

  const onRetry = () => {
    const next = new URLSearchParams(params);
    next.delete("error");
    setParams(next, { replace: true });
    retry();
  };

  return (
    <div className="auth-app">
      <AppHeader />
      <main className="auth-main">
        <section className="auth-card">
          <Link className="auth-back" to={returnTo}>
            返回
          </Link>
          <h1 ref={headingRef} tabIndex={-1}>
            登录
          </h1>
          {view.message ? <p className="auth-lead">{view.message}</p> : null}
          {view.status ? (
            <p className="auth-status" aria-live="polite">
              {view.status}
            </p>
          ) : null}
          {view.alert ? (
            <p className="auth-error" role="alert">
              {view.alert}
            </p>
          ) : null}
          {view.retry ? (
            <button
              type="button"
              className="auth-header-btn"
              onClick={onRetry}
              disabled={busy}
              aria-busy={busy}
            >
              重试
            </button>
          ) : null}
          <p className="auth-note">{LOGIN_PRIVACY_COPY}</p>
        </section>
      </main>
      <footer className="auth-foot">
        <strong>免责声明：</strong>
        {DIVIDEND_DISCLAIMER}
      </footer>
    </div>
  );
}
